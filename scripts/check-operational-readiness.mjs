#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);

const contract = JSON.parse(
  readFileSync(join(repoRoot, 'contracts', 'operational-readiness.contract.json'), 'utf8'),
);
const slos = JSON.parse(readFileSync(join(repoRoot, 'contracts', 'slos.contract.json'), 'utf8'));
const oncallPath = join(repoRoot, String(contract.oncallRunbookPath));
const oncall = readFileSync(oncallPath, 'utf8');
const drillLogPath = join(repoRoot, String(contract.opsDrillLogPath ?? 'runtime/ops-drill-log.json'));
const drillLog = JSON.parse(readFileSync(drillLogPath, 'utf8'));
const pagerProbeLogPath = join(repoRoot, String(contract.pagerProbeLogPath ?? 'runtime/pager-delivery-probe.json'));
const pagerProbeLog = JSON.parse(readFileSync(pagerProbeLogPath, 'utf8'));

const violations = [];
for (const tokenRaw of contract.requiredRunbookTokens ?? []) {
  const token = String(tokenRaw ?? '').trim();
  if (token && !oncall.includes(token)) {
    violations.push(`oncall runbook missing token "${token}"`);
  }
}

for (const slo of slos.slos ?? []) {
  const playbookRef = String(slo.escalation?.playbookRef ?? '').trim();
  const onCallGroup = String(slo.escalation?.onCallGroup ?? '').trim();
  if (!playbookRef || !existsSync(join(repoRoot, playbookRef))) {
    violations.push(`SLO ${slo.id}: missing playbook ref file "${playbookRef}"`);
  }
  if (contract.requiredOnCallGroupsFromSloEscalation && onCallGroup && !oncall.includes(onCallGroup)) {
    violations.push(`On-call addendum missing escalation group reference "${onCallGroup}"`);
  }
}

const requiredDrillFields = (contract.requiredDrillFields ?? []).map((f) => String(f ?? '').trim());
const maxAck = Number(contract.maxAckMinutesGlobal ?? 0);
const allowedAckSources = new Set(
  (contract.allowedEscalationAckSources ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
);
const requiredPagerProbeFields = (contract.requiredPagerProbeFields ?? []).map((f) => String(f ?? '').trim());
const allowedPagerProviders = new Set(
  (contract.allowedPagerProviders ?? []).map((p) => String(p ?? '').trim()).filter(Boolean),
);
const maxProbeAgeMinutes = Number(contract.maxProbeAgeMinutes ?? 0);
const groupsWithDeliveredProbe = new Set();
for (const [idx, drill] of (drillLog.drills ?? []).entries()) {
  for (const field of requiredDrillFields) {
    if (!(field in drill)) {
      violations.push(`Ops drill #${idx} missing field "${field}"`);
    }
  }
  const ackMinutes = Number(drill.ackMinutes);
  if (Number.isFinite(maxAck) && maxAck > 0 && Number.isFinite(ackMinutes) && ackMinutes > maxAck) {
    violations.push(`Ops drill ${drill.id ?? `#${idx}`} ackMinutes ${ackMinutes} exceeds max ${maxAck}.`);
  }
  if (drill.onCallGroup && !oncall.includes(String(drill.onCallGroup))) {
    violations.push(`Ops drill ${drill.id ?? `#${idx}`} references unknown on-call group "${drill.onCallGroup}".`);
  }
  if (String(drill.escalationDelivery ?? '').trim() !== 'delivered') {
    violations.push(`Ops drill ${drill.id ?? `#${idx}`} escalationDelivery must be "delivered".`);
  }
  const ackSource = String(drill.escalationAckSource ?? '').trim();
  if (allowedAckSources.size > 0 && !allowedAckSources.has(ackSource)) {
    violations.push(
      `Ops drill ${drill.id ?? `#${idx}`} uses unsupported escalationAckSource "${ackSource}".`,
    );
  }
}

for (const [idx, probe] of (pagerProbeLog.probes ?? []).entries()) {
  for (const field of requiredPagerProbeFields) {
    if (!(field in probe)) {
      violations.push(`Pager probe #${idx} missing field "${field}"`);
    }
  }
  const probeId = probe.id ?? `#${idx}`;
  const provider = String(probe.provider ?? '').trim();
  if (allowedPagerProviders.size > 0 && !allowedPagerProviders.has(provider)) {
    violations.push(`Pager probe ${probeId} uses unsupported provider "${provider}".`);
  }
  if (String(probe.deliveryStatus ?? '').trim() !== 'delivered') {
    violations.push(`Pager probe ${probeId} deliveryStatus must be "delivered".`);
  }
  if (!String(probe.providerMessageId ?? '').trim()) {
    violations.push(`Pager probe ${probeId} missing providerMessageId.`);
  }
  const group = String(probe.onCallGroup ?? '').trim();
  if (group && !oncall.includes(group)) {
    violations.push(`Pager probe ${probeId} references unknown on-call group "${group}".`);
  }
  const probeTs = Date.parse(String(probe.probeAt ?? ''));
  if (!Number.isFinite(probeTs)) {
    violations.push(`Pager probe ${probeId} has invalid probeAt timestamp.`);
  } else if (maxProbeAgeMinutes > 0) {
    const ageMinutes = (Date.now() - probeTs) / 60000;
    if (ageMinutes > maxProbeAgeMinutes) {
      violations.push(
        `Pager probe ${probeId} is stale (${Math.floor(ageMinutes)}m old, max ${maxProbeAgeMinutes}m).`,
      );
    }
  }
  if (group && String(probe.deliveryStatus ?? '').trim() === 'delivered') {
    groupsWithDeliveredProbe.add(group);
  }
}

if (contract.requireProbeForEachOnCallGroup === true) {
  const sloGroups = new Set(
    (slos.slos ?? [])
      .map((slo) => String(slo.escalation?.onCallGroup ?? '').trim())
      .filter(Boolean),
  );
  for (const group of sloGroups) {
    if (!groupsWithDeliveredProbe.has(group)) {
      violations.push(`Missing delivered pager probe for on-call group "${group}".`);
    }
  }
}

if (violations.length > 0) {
  console.error('Operational readiness contract failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-operational-readiness: OK');

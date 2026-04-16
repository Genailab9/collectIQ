# CollectIQ Go-Live Runbook (Production Freeze)

## Scope
- Backend stabilization rollout for current governed runtime.
- No architecture expansion; operate with current CI/runtime contracts.

## Pre-Flight (must pass)
- `npm run lint` in `backend`
- `npm run lint` in `frontend`
- Verify enforce-mode query governance is green (`actionable=0`).
- Verify invariants guard is green (`check-invariants-contract: OK`).

## SLO Starter Thresholds
- API latency p95 <= 1000ms (`collectiq_api_latency_ms_bucket`)
- API error ratio <= 2% (`collectiq_api_errors_total` / `collectiq_api_requests_total`)
- Worker latency p95 <= 5000ms (`collectiq_worker_latency_ms_bucket`)
- Worker backlog depth <= 500 (`collectiq_worker_backlog_depth`)
- SSE listener rejections == 0 (`collectiq_sse_listener_rejected_total`)
- Projection integrity failures == 0 (`collectiq_projection_integrity_errors_total`)

## Alert Starter Thresholds
- Page: projection integrity failure count > 0 for 5m.
- Page: API error ratio > 5% for 5m.
- Warn: API p95 > 1000ms for 10m.
- Warn: worker backlog > 500 for 10m.
- Warn: SSE listener rejects > 0 in 5m.

## Rollout Sequence
- Stage 1: 5% tenant traffic (30 min)
- Stage 2: 25% tenant traffic (60 min)
- Stage 3: 50% tenant traffic (60 min)
- Stage 4: 100% rollout after stable thresholds

## Rollback Triggers
- Projection integrity failures > 0 sustained 5m.
- API error ratio > 8% sustained 5m.
- Worker backlog > 1000 sustained 10m.
- SSE listener rejects continuously increasing for 10m.

## Operational Checks During Rollout
- Watch API and worker latency histograms.
- Watch worker backlog and survival queue depth gauges.
- Watch SSE listener gauges and reject counters.
- Watch replay/projection integrity counters.

## Post-Go-Live (24h)
- Confirm no growth in query-governance actionable findings.
- Confirm no critical alert trigger fired.
- Capture baseline values for SLO tuning in `contracts/slos.contract.json`.

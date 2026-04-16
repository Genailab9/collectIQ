import { ForbiddenException } from '@nestjs/common';
import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  QueryEvent,
  UpdateEvent,
  getMetadataArgsStorage,
} from 'typeorm';
import { tenantAls } from './tenant-als';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';
import { mapTableToRequirementId } from '../runtime-proof/requirement-map';

function hasTenantIdColumn(entity: object): entity is { tenantId: unknown } {
  return 'tenantId' in entity;
}

/**
 * PRD §15 — tenant-scoped rows must carry `tenantId`; when ALS tenant is set, it must match.
 */
@EventSubscriber()
export class TenantIsolationSubscriber implements EntitySubscriberInterface {
  beforeQuery(event: QueryEvent<object>): void {
    const sql = event.query.trim();
    if (!isGuardedDml(sql)) {
      return;
    }
    const referencedTables = getReferencedTables(sql);
    if (referencedTables.length === 0) {
      return;
    }
    const tenantScopedTables = getTenantScopedTableNames();
    const systemGlobalTables = getSystemGlobalTableNames(tenantScopedTables);
    if (referencedTables.every((table) => systemGlobalTables.has(table))) {
      return;
    }
    const referencedTenantTables = referencedTables.filter(
      (table) => tenantScopedTables.has(table) && !systemGlobalTables.has(table),
    );
    if (referencedTenantTables.length === 0) {
      return;
    }
    const ctx = tenantAls.getStore()?.tenantId?.trim();
    if (!ctx) {
      emitRuntimeProof({
        requirement_id: 'REQ-TEN-001',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { reason: 'tenant_context_missing_query', query: sql.slice(0, 200) },
      });
      throw new ForbiddenException('Tenant context missing');
    }
  }

  beforeInsert(event: InsertEvent<object>): void {
    this.assertTenantScopedRow('insert', event.entity);
    this.emitMutationProof('INSERT', event.metadata.tableName, event.entity);
  }

  beforeUpdate(event: UpdateEvent<object>): void {
    if (event.entity && typeof event.entity === 'object') {
      this.assertTenantScopedRow('update', event.entity);
      this.emitMutationProof('UPDATE', event.metadata.tableName, event.entity);
    }
  }

  private emitMutationProof(
    operation: 'INSERT' | 'UPDATE',
    tableName: string,
    entity: object | undefined,
  ): void {
    const tenantFromContext = tenantAls.getStore()?.tenantId?.trim();
    const tenantFromEntity =
      entity && hasTenantIdColumn(entity) && typeof entity.tenantId === 'string'
        ? entity.tenantId.trim()
        : undefined;
    const tenantId = tenantFromEntity || tenantFromContext || 'n/a';
    emitRuntimeProof({
      requirement_id: mapTableToRequirementId(tableName),
      event_type: 'DB_MUTATION',
      tenant_id: tenantId,
      metadata: {
        table: tableName,
        operation,
      },
    });
  }

  private assertTenantScopedRow(op: 'insert' | 'update', entity: object | undefined): void {
    if (!entity || typeof entity !== 'object') {
      return;
    }
    if (!hasTenantIdColumn(entity)) {
      return;
    }
    const tid = entity.tenantId;
    if (typeof tid !== 'string' || tid.trim() === '') {
      throw new ForbiddenException(`PRD §15: tenantId is required on tenant-scoped ${op}.`);
    }
    const ctx = tenantAls.getStore()?.tenantId?.trim();
    if (ctx && tid.trim() !== ctx) {
      throw new ForbiddenException(
        `PRD §15: ${op} tenantId does not match active tenant context (cross-tenant blocked).`,
      );
    }
  }
}

function isGuardedDml(sql: string): boolean {
  return /^\s*(select|update|delete)\b/i.test(sql);
}

function getTenantScopedTableNames(): ReadonlySet<string> {
  const storage = getMetadataArgsStorage();
  const cols = storage.columns;
  const tables = storage.tables;
  const tenantScoped = new Set<string>();
  const tenantTargets = new Set<unknown>();
  for (const c of cols) {
    const dbName = String(c.options?.name ?? '').trim().toLowerCase();
    const prop = String(c.propertyName ?? '').trim().toLowerCase();
    if (dbName === 'tenant_id' || prop === 'tenantid') {
      tenantTargets.add(c.target);
      const target = c.target as { name?: string } | string;
      const entityName = typeof target === 'string' ? target : String(target?.name ?? '').trim();
      if (entityName) {
        tenantScoped.add(entityName.toLowerCase());
      }
    }
  }
  for (const t of tables) {
    if (!tenantTargets.has(t.target)) {
      continue;
    }
    const tableName = String(t.name ?? '').trim().toLowerCase();
    if (tableName) {
      tenantScoped.add(tableName);
    }
  }
  return tenantScoped;
}

function getSystemGlobalTableNames(tenantScopedTables: ReadonlySet<string>): ReadonlySet<string> {
  const storage = getMetadataArgsStorage();
  const out = new Set<string>();
  for (const t of storage.tables) {
    const tableName = String(t.name ?? '').trim().toLowerCase();
    if (!tableName) {
      continue;
    }
    if (!tenantScopedTables.has(tableName)) {
      out.add(tableName);
    }
  }
  const explicitExemptions = ['tenant_approval_policy', 'tenant_compliance_policy'];
  for (const tableName of explicitExemptions) {
    if (storage.tables.some((t) => String(t.name ?? '').trim().toLowerCase() === tableName)) {
      out.add(tableName);
    }
  }
  return out;
}

function getReferencedTables(sql: string): string[] {
  const referenced = new Set<string>();
  const regex =
    /\b(?:from|join|update|into|delete\s+from)\s+(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;
  let match: RegExpExecArray | null = regex.exec(sql);
  while (match) {
    const table = String(match[2] ?? '').trim().toLowerCase();
    if (table) {
      referenced.add(table);
    }
    match = regex.exec(sql);
  }
  return [...referenced];
}

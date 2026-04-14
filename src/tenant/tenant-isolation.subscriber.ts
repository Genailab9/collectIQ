import { ForbiddenException } from '@nestjs/common';
import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  QueryEvent,
  UpdateEvent,
} from 'typeorm';
import { tenantAls } from './tenant-als';

function hasTenantIdColumn(entity: object): entity is { tenantId: unknown } {
  return 'tenantId' in entity;
}

/**
 * PRD §15 — tenant-scoped rows must carry `tenantId`; when ALS tenant is set, it must match.
 */
@EventSubscriber()
export class TenantIsolationSubscriber implements EntitySubscriberInterface {
  beforeQuery(event: QueryEvent<object>): void {
    const ctx = tenantAls.getStore()?.tenantId?.trim();
    if (!ctx) {
      return;
    }
    const sql = event.query.trim().toLowerCase();
    if (!requiresTenantGuard(sql)) {
      return;
    }
    if (isPrimaryKeyLookup(sql)) {
      return;
    }
    if (sql.includes('tenant_id')) {
      return;
    }
    throw new ForbiddenException(
      'PRD §15: tenant-scoped query must include tenant_id predicate before execution.',
    );
  }

  beforeInsert(event: InsertEvent<object>): void {
    this.assertTenantScopedRow('insert', event.entity);
  }

  beforeUpdate(event: UpdateEvent<object>): void {
    if (event.entity && typeof event.entity === 'object') {
      this.assertTenantScopedRow('update', event.entity);
    }
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

function isPrimaryKeyLookup(sql: string): boolean {
  if (!sql.startsWith('select')) {
    return false;
  }
  if (!sql.includes(' where ')) {
    return false;
  }
  if (sql.includes('tenant_id')) {
    return false;
  }
  return sql.includes('"id"') || sql.includes('.id');
}

function requiresTenantGuard(sql: string): boolean {
  const guardedTables = [
    'state_transition_log',
    'smek_orchestration_audit',
    'payment_gateway_intent_links',
    'sync_case_snapshot',
    'webhook_events',
    'idempotency_keys',
    'data_ingestion_records',
  ];
  const guarded = guardedTables.some((table) => sql.includes(` ${table} `) || sql.includes(`"${table}"`));
  if (!guarded) {
    return false;
  }
  return sql.startsWith('select') || sql.startsWith('update') || sql.startsWith('delete');
}

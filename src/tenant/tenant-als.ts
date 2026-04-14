import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantAlsStore {
  readonly tenantId: string;
}

/** Request / job scoped tenant (PRD v1.2 §5). */
export const tenantAls = new AsyncLocalStorage<TenantAlsStore>();

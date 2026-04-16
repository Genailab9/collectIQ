# CollectIQ SaaS Engineering Standard (v1.0)

Everything must be safe, observable, and multi-tenant correct by default.

## 1) Architecture Standards

### Mandatory layers

Every backend feature must follow:

`Controller -> Service -> Domain -> Persistence` with observability hooks.

Rules:

- No DB access in controllers
- No business logic in controllers
- No cross-module direct DB writes
- No bypassing service layer for quick fixes

CI guardrail:

- Fail if `*.controller.ts` imports DB clients directly (`typeorm`, `@nestjs/typeorm`, `prisma`, `knex`)

### Domain isolation (critical)

Every business operation must declare:

- `tenantId: string`
- `correlationId: string`
- `actorId?: string`

Rules:

- No DB query without tenant scope
- No event emission without `correlationId`
- No cross-tenant joins
- No global cache key without tenant prefix
- Admin-plane global queries must be explicitly marked with `@AdminPlaneQuery()`

CI guardrail:

- Raw SQL scanner requiring tenant predicate in `SELECT/UPDATE/DELETE` statements
- Admin-plane query guard requiring `@AdminPlaneQuery()` on approved global-read methods

### Event-driven mutation rule

All state changes must emit events:

- `STATE_TRANSITION`
- `DOMAIN_EVENT`
- `AUDIT_EVENT`
- `WEBHOOK_EVENT`

Rules:

- No silent state change
- No DB mutation without event emission or kernel loop
- Events must be idempotent

CI guardrail:

- Heuristic scan that flags mutation-heavy files missing `emit`, `publish`, `record`, or `executeLoop`

## 2) Security Standards

### Authn/authz

Rules:

- No header-only auth
- Validate identity, tenant scope, and role/permission for all APIs
- Privileged operations require `ADMIN | SYSTEM` role or service key plus ACL
- Control-plane authorization must flow through PolicyEvaluator + PolicyDecisionAudit
- Policy rollout mode must be centralized (PolicyModeService), never read ad hoc in controllers

CI guardrail:

- Block permissive header-only allow logic without RBAC/ACL check
- Fail control-plane controllers missing `this.policies.evaluate(...)` or `this.policyAudit.record(...)`
- Fail if control-plane controllers read `POLICY_EVALUATOR_MODE` directly instead of PolicyModeService

### Feature flag security

Rules:

- Tenant flags are read-only by default
- System flags are write-protected
- Protected flags include:
  - `ALLOW_TRACE_FULL`
  - `DISABLE_TRACE_FULL`
  - `BYPASS_TENANT_ISOLATION`

CI guardrail:

- Block write paths touching protected flags without `ADMIN` check

### Multi-tenant isolation (hard rule)

Rules:

- Every query must include tenant scope
- No global selects without tenant filter
- No shared cache keys without tenant prefix
- No cross-tenant replay unless explicit admin tooling

## 3) State Machine Standards

### State mutation entrypoint

Only supported entrypoint:

- `executeLoop()`

Rules:

- No direct state table mutation outside kernel
- No manual transitions outside kernel path

CI guardrail:

- Existing write guard (`check-state-machine-writes.mjs`) remains mandatory

### Terminal state enforcement

Terminal states:

- `SUCCESS`
- `FAILED`
- `REJECTED`
- `CLOSED`

Rules:

- No outgoing transitions from terminal states
- No retries unless explicit rehydration flow

CI guardrail:

- Validate no outgoing adjacency edges from terminal nodes

## 4) Observability Standards

### Structured logs

All logs must include:

- `message`
- `level`
- `tenantId`
- `correlationId`
- `timestamp`

Rules:

- No raw object payload dumping
- No secret logging
- No unbounded log strings

CI guardrail:

- Block `console.log(...)` in source code

### Trace modes

Two trace modes only:

- `summary` (default)
- `full` (admin-only)

Rules:

- Summary mode must not decrypt payloads or expose raw webhook bodies
- Full mode requires explicit authorization

### Metrics

All modules should expose:

- latency
- error rate
- throughput
- retry counts

CI guardrail:

- Ensure module-level `collectiq_` metric registration

## 5) API Standards

Rules:

- Browser calls go through `/api/collectiq/*`
- No direct frontend-to-backend bypasses
- No secret leakage to browser
- BFF is mandatory boundary

Response contract:

```ts
{
  success: boolean,
  data?: unknown,
  error?: { code: string; message: string },
  correlationId: string
}
```

## 6) Performance Standards

Rules:

- No N+1 queries
- No per-row enrichment loops issuing DB calls
- Prefer joins, batch queries, CTEs

CI guardrail:

- Detect repeated DB calls inside loops

Caching rules:

- Cache keys include `tenantId + resourceId + version`
- TTL required for all cache entries

## 7) Event Streaming (SSE/Redis)

Rules:

- Tenant-isolated channels
- No global broadcast channels
- Redis required in production

CI guardrail:

- Fail on wildcard/global publish topics

## 8) Error Handling Standards

Rules:

- Errors must be mapped, typed, and observable
- No unknown error passthrough to client
- No stack trace leakage in production responses

## 9) Testing Standards

Required layers:

1. Unit tests (domain)
2. Integration tests (service + DB)
3. Contract tests (API + BFF)
4. Chaos tests (state + events)

CI guardrail:

- Fail business-logic modules with no test coverage signal

## 10) CI/CD Enforcement

Mandatory CI gates:

- Static checks: ESLint strict, TS strict, forbidden pattern scans
- Architecture checks: controller DB ban, tenant scope checks, event guardrails
- Security checks: no secret exposure, admin endpoints must include RBAC guard
- Observability checks: logging, metrics, and error mapping required

## 11) Golden Rules

1. Multi-tenancy is mandatory.
2. Events are source of truth.
3. Observability is a product feature.
4. No silent mutations.
5. BFF is the only browser entry point.

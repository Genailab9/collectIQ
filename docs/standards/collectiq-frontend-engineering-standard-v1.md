# CollectIQ Frontend Engineering Standard v1.0

Enforced + CI-governed + migration-backed.

## 1. Core Principle

The frontend is a controlled execution client of a governed backend system, not an application layer.

Implications:

- No direct API freedom
- No local state ownership of shared domains
- No uncontrolled polling or data fetching
- No bypass of BFF contract layer

## 2. Architecture Rules (Hard Enforcement)

### 2.1 Single API Boundary (Critical)

All browser-to-server communication must go through:

`/api/collectiq/*`

Forbidden:

- any `/api/*` path outside `/api/collectiq/*` (including legacy auth/admin/onboarding surfaces)
- `/api/admin/*`
- `/api/saas/*`
- direct backend URLs
- external API calls from browser

CI enforcement:

- fail if client code has `fetch("/api/*")` that does not start with `/api/collectiq/`
- fail if client code has `axios.*("/api/*")` outside `/api/collectiq/`

### 2.2 BFF Contract is Source of Truth

All endpoints must exist in:

`frontend/config/bff-contract.json`

CI checks:

- every route in code must exist in contract
- no orphan API endpoints
- no undocumented fetch calls

### 2.3 No Backend Knowledge Leakage

Forbidden in frontend:

- SQL-like filters
- domain machine states as authority
- backend enums not exposed via API schema

## 3. Folder Structure Standard

Required target structure:

```
frontend/
  app/                  # routes only, no business logic
  features/
    execution/
    approval/
    observability/
    tenant/
    system/
  lib/
    api/
    client/
    hooks/
    policies/
  components/
    ui/
    shared/
  config/
    bff-contract.json
    env.ts
  state/
    query-client.ts
    cache-strategy.ts
  hooks/
    usePollingPolicy.ts
    useEventStream.ts
  policies/
    ui-policy.ts
```

Forbidden patterns:

- business logic inside `/app`
- API calls inside `/components/ui`
- feature logic in `/components/shared`
- duplicate hooks per feature for same domain

## 4. State Management Rules

### 4.1 Single Source of Truth per domain

Each domain must have:

- one query hook
- one cache key namespace
- one invalidation path

### 4.2 No independent polling

Forbidden:

```ts
setInterval(() => refetch(), 5000)
```

Required:

```ts
usePollingPolicy({ ... })
```

### 4.3 Event-driven updates preferred

Priority:

1. SSE/Event stream
2. query invalidation
3. polling fallback (policy-gated)

## 5. Security Rules

### 5.1 No secrets in frontend

CI block for secret-like usage:

- `API_KEY`
- `SECRET`
- `PASSWORD`
- `ADMIN_KEY`
- fallback credentials in code

### 5.2 Authentication is server-owned

Frontend must not:

- validate roles for security enforcement
- enforce access control as authority
- assume authorization state beyond UI rendering

### 5.3 Tenant safety is implicit

- tenant context injected globally
- never manually passed in components as security authority

## 6. Data Fetching Standard

### 6.1 API layer is mandatory

Allowed:

```ts
apiClient.execution.list();
```

Forbidden:

```ts
fetch("/api/collectiq/execution");
```

### 6.2 Retry logic centralization

- retries defined in API layer
- not per-component

## 7. Performance Rules

### 7.1 No uncontrolled re-renders

- dashboards must use memoized selectors
- SSE updates should be batched

### 7.2 No duplicate queries

CI should detect multiple components hitting same endpoint independently.

### 7.3 Network efficiency rules

- prefer batched APIs
- pagination required for list endpoints

## 8. Observability Rules

Frontend must emit:

- route load time
- API latency sample
- error boundary logs

Forbidden:

- raw payload logging
- sensitive data logging

## 9. Testing Standard

Required coverage:

- unit tests (hooks/utils)
- API contract tests (BFF alignment)
- critical flows:
  - execution
  - approval
  - payment
  - observability trace

CI fail if:

- no test suite in feature domain
- missing API contract coverage

## 10. CI Enforcement Rules

### 10.1 Hard fail rules

CI must fail if:

- non-collectiq API fetch exists
- missing BFF contract entry
- secret-like env usage in frontend
- duplicate polling loops detected
- cross-feature imports violating domain boundary rules

### 10.2 Warning rules (shadow mode)

- multiple components using same query independently
- missing memoization in SSE-bound components
- missing error boundary coverage

## 11. Migration Plan (Critical)

### Phase 1 — Contract lock (done)

- BFF contract enforced
- API surface unified

### Phase 2 — State consolidation

- introduce `usePollingPolicy`
- migrate polling to policy hook
- remove direct polling decisions in components

### Phase 3 — API standardization

- enforce API client usage only
- remove raw `fetch()` from client UI files

### Phase 4 — Domain isolation

- enforce feature/domain boundary imports
- prevent cross-domain coupling

### Phase 5 — Performance hardening

- batch APIs
- cache normalization
- SSE-first updates

## 12. Final System Guarantee Model

If fully enforced:

- deterministic frontend behavior
- zero API drift
- tenant-safe UI by construction
- predictable scaling under SSE load
- no hidden polling cost explosion

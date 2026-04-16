# CollectIQ Backend

This branch contains the NestJS backend for CollectIQ (SMEK orchestration, APIs, demo controls, analytics, and observability).

## Branch Strategy (Dual-Repo Layout)

This GitHub repository hosts two independent roots on separate long-lived branches:

- `frontend` -> Next.js UI (separate git root in `../frontend`)
- `backend` -> this NestJS API root

### Working Rules

- Backend changes: branch from `backend`, open PR back into `backend`.
- Frontend changes: branch from `frontend`, open PR back into `frontend`.
- Do not merge `frontend` into `backend` or `backend` into `frontend`; histories are intentionally separate.

## Local Run

```bash
npm install
npm run env:auto
npm run build
npm run start:dev
```

Required environment variables:

- `COLLECTIQ_API_KEYS`
- `COLLECTIQ_DATA_KEY`

Common deployment/runtime variables:

- `PORT`
- `NEXT_PUBLIC_APP_URL`
- `APP_BOOT_MODE` (`demo-safe` or `strict`)
- `COLLECTIQ_REQUIRE_TLS`
- `COLLECTIQ_TRUST_PROXY`
- `REDIS_URL` (**required in production**)
- `DISABLE_TRACE_FULL` (`true|false`, global kill switch)
- `COLLECTIQ_LOGS_MAX_PER_SECOND` (default `100`)
- `COLLECTIQ_LOGS_REDIS_MAX_ENTRIES` (default `3000` per tenant)
- `COLLECTIQ_LOGS_REDIS_TTL_SECONDS` (default `172800`)
- `COLLECTIQ_TRACE_SUMMARY_CACHE_TTL_SECONDS` (default `8`)

Optional provider variables (boot will continue in `demo-safe` mode when missing):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `OPENAI_API_KEY`

## Auto Config

Generate a safe local `.env` with one command:

```bash
npm run env:auto
```

This keeps existing values when present and auto-generates missing secure defaults, including base64 AES-256 keys for:

- `COLLECTIQ_DATA_KEY`
- `COLLECTIQ_PII_KEY`

## Production Start

```bash
npm run start:prod
```

## Chaos Certification Pack

Run repeatable scenario-driven resilience checks and produce a JSON scale-confidence report:

```bash
npm run chaos:test -- --scenario=payment-burst --tenant=tenant_a --api-key=YOUR_KEY --base-url=http://localhost:3000
```

Scenarios:

- `payment-burst`
- `approval-timeout-wave`
- `webhook-duplication-storm` (requires `--admin-key` for replay trigger)
- `mixed-chaos`

Optional args:

- `--duration=45` (seconds)
- `--poll-ms=3000`
- `--out=./chaos-report.json`
- `--admin-key=<COLLECTIQ_ADMIN_API_KEY>`

Report includes:

- scenario summary + duration
- before/after snapshots
- key metrics deltas
- invariant checks:
  - no duplicate domain events
  - no cross-tenant leakage
  - bounded retries
  - backlog growth guard
- final verdict (`PASS` / `WARNING` / `FAIL`)

## Observability + Redis dependency matrix

| Component | Redis required | Behavior when Redis unavailable |
| --- | --- | --- |
| SSE fanout | Yes (production) | Boot fails in `NODE_ENV=production` (env validation) |
| Structured logs | Yes (production) | Boot fails in production; in non-production, falls back to in-memory ring with warning |
| Trace summary | No | Works without cache (higher DB load expected) |
| Trace full | No | Works (server-side gated by tenant flag + kill switch) |

### Full trace authorization

- API: `GET /api/v1/observability/trace/:correlationId?mode=summary|full`
- Default mode is `summary`.
- `mode=full` requires:
  - `X-CollectIQ-Debug: true` request signal, and
  - tenant feature flag `ALLOW_TRACE_FULL = true`, and
  - `DISABLE_TRACE_FULL != true`.

### Failure-mode notes

- If Redis goes down in production, readiness should fail and service restart/traffic failover should trigger.
- `collectiq_logs_dropped_total` rising means per-tenant log write throttling is active.
- `collectiq_trace_summary_cache_miss_total` rising with low hit ratio indicates higher DB pressure from summary traces.

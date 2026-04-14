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
- `COLLECTIQ_REQUIRE_TLS`
- `COLLECTIQ_TRUST_PROXY`

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

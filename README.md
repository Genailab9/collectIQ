# CollectIQ Frontend

This branch contains the Next.js frontend for CollectIQ.

## Branch Strategy (Dual-Repo Layout)

This GitHub repository is used with two independent roots, each pushed to its own long-lived branch:

- `frontend` -> Next.js app (this folder / this git root)
- `backend` -> NestJS API + SMEK orchestration (separate git root in `../backend`)

Recommended default branch: `frontend`.

### Working Rules

- Frontend changes: branch from `frontend`, open PR back into `frontend`.
- Backend changes: branch from `backend`, open PR back into `backend`.
- Avoid cross-merging `frontend` and `backend` branches; they represent different git histories.

## Local Run

```bash
npm install
npm run dev
```

Set environment variables:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`

## Build

```bash
npm run lint
npm run build
```

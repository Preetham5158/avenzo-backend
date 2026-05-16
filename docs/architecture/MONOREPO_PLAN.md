# Monorepo Plan

Status: completed and historical.

This document used to describe a future migration into a monorepo. That migration has now happened. The active source of truth is:

- `docs/architecture/MONOREPO_STRUCTURE.md`
- `docs/architecture/FOUNDATIONAL_ARCHITECTURE.md`
- `docs/architecture/BACKEND_BOUNDARIES.md`
- `docs/architecture/FRONTEND_BOUNDARIES.md`
- `docs/architecture/SHARED_PACKAGES.md`

## Current Implemented Structure

```text
apps/
  api/
  customer-web/
  restaurant-web/
  customer-mobile/
  restaurant-mobile/

packages/
  shared/
  api-client/
  ui/
  config/

docs/
```

## Completed Decisions

- Avenzo uses a monorepo.
- npm workspaces are the package manager.
- `apps/api` is the only backend.
- `apps/api` owns Prisma and database access.
- Web and mobile apps are client apps only.
- Shared contracts and utilities live in `packages/shared`.
- Shared API calling code lives in `packages/api-client`.
- Shared UI tokens and small primitives live in `packages/ui`.
- Shared tooling configuration lives in `packages/config`.

## Historical Context

Earlier planning considered a future extraction of shared types and mobile apps. That is no longer the active plan because the repo already contains the target app and package workspaces.

For current rules, use `MONOREPO_STRUCTURE.md` instead of this historical note.

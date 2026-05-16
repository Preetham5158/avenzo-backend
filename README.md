# Avenzo

Avenzo is a restaurant dine-in ordering platform organized as a long-term monorepo. The current focus is a clean foundation: one backend, one database, clear app boundaries, and stable API contracts for web and mobile clients.

## Architecture Summary

- `apps/api` is the only backend runtime.
- `apps/api` owns Prisma, database access, migrations, routes, jobs, services, auth, payments, webhooks, and API contracts.
- Web and mobile apps are clients only.
- Frontend and mobile apps must call the API and must not import Prisma or use database credentials.
- Shared packages are for reusable contracts, API client code, UI tokens, and tooling config.

## Monorepo Overview

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

## Install

```bash
npm install
```

This repo uses npm workspaces and the root `package-lock.json`.

## Run Backend

```bash
npm run api:start
```

For development:

```bash
npm run api:dev
```

## Tests

```bash
npm run api:test
```

## Prisma

```bash
npm run api:prisma:validate
npm run api:prisma:generate
npm run api:prisma:migrate:deploy
```

Prisma schema and migrations live under `apps/api/prisma`.

## Build and Checks

```bash
npm run build
npm run lint
```

## Deployment

Render deploys the backend runtime from `apps/api` behavior. Backend secrets such as `DATABASE_URL`, `DIRECT_URL`, Redis, Razorpay, JWT, and webhook secrets are backend-only. Frontend and mobile apps should receive only public API base URLs.

Keep `/health` and `/ready` stable for deployment validation.

## Static Compatibility

`apps/api/public` and the `webCompat` routes are temporary compatibility layers for the current static web experience. They must remain working until `apps/customer-web` and `apps/restaurant-web` fully replace them and parity is tested.

## Architecture Docs

- [Foundational Architecture](docs/architecture/FOUNDATIONAL_ARCHITECTURE.md)
- [Monorepo Structure](docs/architecture/MONOREPO_STRUCTURE.md)
- [Backend Boundaries](docs/architecture/BACKEND_BOUNDARIES.md)
- [Frontend Boundaries](docs/architecture/FRONTEND_BOUNDARIES.md)
- [Shared Packages](docs/architecture/SHARED_PACKAGES.md)
- [Static Web Migration](docs/architecture/STATIC_WEB_MIGRATION.md)
- [API Contract Strategy](docs/architecture/API_CONTRACT_STRATEGY.md)
- [Deployment Structure](docs/architecture/DEPLOYMENT_STRUCTURE.md)
- [Decision Records](docs/architecture/DECISION_RECORDS.md)

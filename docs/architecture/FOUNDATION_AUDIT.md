# Foundation Audit - Historical Restructure Note

Status: historical.

This audit records the backend restructure that moved the original backend into the current npm-workspaces monorepo. The active architecture references are:

- `docs/architecture/FOUNDATIONAL_ARCHITECTURE.md`
- `docs/architecture/MONOREPO_STRUCTURE.md`
- `docs/architecture/BACKEND_BOUNDARIES.md`
- `docs/architecture/BACKEND_ARCHITECTURE.md`

## Current Backend Location

The backend now lives in `apps/api`.

Important paths:

- `apps/api/src/index.js` - Express app bootstrap.
- `apps/api/src/app.js` - re-exports `app` for tests.
- `apps/api/src/server.js` - standalone server runner.
- `apps/api/src/prisma.js` - Prisma client factory.
- `apps/api/prisma/schema.prisma` - Prisma schema.
- `apps/api/prisma/migrations` - Prisma migrations.
- `apps/api/public` - temporary static web compatibility files.
- `apps/api/src/routes/web-compat.routes.js` - web compatibility route aggregator.
- `apps/api/src/modules/webCompat/*` - temporary compatibility routes used by static HTML pages.

## What Must Be Kept Temporarily

- `apps/api/src/modules/webCompat/*`
- `apps/api/src/routes/web.routes.js`
- `apps/api/src/routes/web-compat.routes.js`
- `apps/api/public/*`

These files support the current static HTML frontend. They should be removed only after `apps/customer-web` and `apps/restaurant-web` fully replace the static pages and parity is tested.

## Active /api/v1 Routes

`apps/api/src/routes/v1.routes.js` mounts the stable `/api/v1` API modules.

Current domains include:

- Customer and restaurant auth.
- Public restaurant/menu/order lookup.
- Customer orders.
- Restaurant operations.
- Payments.
- Device token registration.

The webhook route `/webhooks/razorpay` is mounted outside `/api/v1` because Razorpay calls it directly with a signed payload.

## Restructure Risks Already Addressed

1. `apps/api/public` path resolution was preserved.
2. Razorpay raw-body capture was preserved.
3. Node dependency resolution now works through root npm workspaces.
4. Prisma config and schema live under `apps/api`.
5. API tests moved with the API and continue to resolve local imports.
6. Compatibility route file names changed, but URL contracts did not.
7. Render starts the backend with `node apps/api/src/server.js`.

## Current Validation Baseline

Use the root commands:

```bash
npm install
npm run build
npm run lint
npm run api:test
npm run api:prisma:validate
npm run api:prisma:generate
```

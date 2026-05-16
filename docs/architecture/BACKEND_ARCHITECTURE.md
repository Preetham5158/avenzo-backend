# Avenzo Backend Architecture

## 1. Project Overview

Avenzo's backend lives in `apps/api`. It is the only backend runtime and owns Express routes, Prisma, database access, migrations, jobs, auth, payments, webhooks, API contracts, and static web compatibility support.

The backend currently supports:

1. Public customer pages served from `apps/api/public`.
2. Customer account and order flows.
3. Restaurant/admin dashboard and operational flows.
4. `/api/v1` JSON API routes for long-term clients.
5. Temporary `webCompat` routes for the existing static HTML frontend.

`apps/api/public` and `apps/api/src/modules/webCompat/*` are temporary compatibility layers. They must remain working until `apps/customer-web` and `apps/restaurant-web` fully replace the static pages and parity is tested.

## 2. Current Folder Structure

```text
apps/api/
  prisma/
    schema.prisma
    migrations/

  src/
    index.js
    app.js
    server.js
    prisma.js
    routes/
      health.routes.js
      web.routes.js
      web-compat.routes.js
      v1.routes.js
    modules/
      auth/
      deviceTokens/
      orders/
      payments/
      public/
      restaurants/
      webCompat/
        otp.helpers.js
        auth.web-compat.routes.js
        public.web-compat.routes.js
        customer.web-compat.routes.js
        admin.web-compat.routes.js
        payment.web-compat.routes.js
      webhooks/
    services/
    middlewares/
    serializers/
    config/
    lib/
    utils/
    jobs/

  public/
  tests/
  openapi/
  scripts/
```

## 3. App Startup Flow

1. `apps/api/src/index.js` loads environment configuration.
2. Express app is created.
3. Trust proxy, CORS, request IDs, security headers, and JSON parsing are configured.
4. Raw body capture is preserved for Razorpay webhook signature verification.
5. `express.static` serves `apps/api/public`.
6. Health, static web, web compatibility, webhook, and `/api/v1` routes are mounted.
7. 404 and global error middleware are registered.
8. `startServer()` connects runtime dependencies and starts the HTTP listener.

## 4. Route Mounting Flow

```text
health.routes           -> /health, /ready
web.routes              -> static HTML page routes
web-compat.routes       -> temporary compatibility API routes for apps/api/public
/webhooks               -> Razorpay webhook routes
/api/v1                 -> stable API routes for current and future clients
404 handler
error handler
```

`apps/api/src/routes/web-compat.routes.js` aggregates the route files under `apps/api/src/modules/webCompat/*`.

## 5. Static Web Compatibility

Static pages are served from `apps/api/public` and page shells are routed by `apps/api/src/routes/web.routes.js`.

| Path | Static file |
|---|---|
| `/` | `apps/api/public/index.html` |
| `/r/:slug` | `apps/api/public/menu.html` |
| `/track/:token` | `apps/api/public/track.html` |
| `/customer-login.html` | `apps/api/public/customer-login.html` |
| `/customer-signup.html` | `apps/api/public/customer-signup.html` |
| `/customer-orders.html` | `apps/api/public/customer-orders.html` |
| `/customer-profile.html` | `apps/api/public/customer-profile.html` |
| `/restaurant-login.html` | `apps/api/public/restaurant-login.html` |

The compatibility API routes under `webCompat` preserve behavior for these static pages. Do not remove them until `apps/customer-web` and `apps/restaurant-web` have complete, tested replacements.

## 6. /api/v1 Routes

All stable JSON API routes should remain under `/api/v1` where applicable.

Current domain modules include auth, public browsing, orders, payments, restaurants, device tokens, and webhooks. `apps/api/src/routes/v1.routes.js` is the `/api/v1` aggregator.

## 7. webCompat Routes

`webCompat` routes are the current compatibility surface for `apps/api/public`. They are not a new product surface and should not be expanded for new client apps.

Files:

- `apps/api/src/routes/web-compat.routes.js`
- `apps/api/src/modules/webCompat/auth.web-compat.routes.js`
- `apps/api/src/modules/webCompat/public.web-compat.routes.js`
- `apps/api/src/modules/webCompat/customer.web-compat.routes.js`
- `apps/api/src/modules/webCompat/admin.web-compat.routes.js`
- `apps/api/src/modules/webCompat/payment.web-compat.routes.js`
- `apps/api/src/modules/webCompat/otp.helpers.js`

Use `/api/v1` and `packages/api-client` for future web and mobile client work.

## 8. Backend Boundaries

- Prisma and database access stay inside `apps/api`.
- Frontend and mobile apps must not import Prisma or backend internals.
- Routes should stay thin.
- Services hold business logic.
- Serializers shape API responses.
- Jobs handle background work.
- Webhooks and payment/order behavior should remain stable and carefully tested.

## 9. Prisma/DB Layer

- Prisma schema: `apps/api/prisma/schema.prisma`.
- Migrations: `apps/api/prisma/migrations`.
- Prisma client factory: `apps/api/src/prisma.js`.
- Production migration command: `npm run api:prisma:migrate:deploy`.
- Validation command: `npm run api:prisma:validate`.
- Generation command: `npm run api:prisma:generate`.

Never use `prisma db push` for production.

## 10. Jobs and Worker

Job queues and processors live under `apps/api/src/jobs`.

Worker start command:

```bash
node apps/api/src/jobs/worker.js
```

The worker uses the same backend-only environment variables as the API runtime.

## 11. Tests and Checks

Common root commands:

```bash
npm run api:test
npm run api:prisma:validate
npm run api:prisma:generate
npm run lint
npm run build
```

API tests live in `apps/api/tests`.

## 12. Deployment Notes

Render should deploy from the monorepo root using npm workspace scripts.

Build command:

```bash
npm run render:build
```

Start command:

```bash
node apps/api/src/server.js
```

Keep `/health` and `/ready` stable.

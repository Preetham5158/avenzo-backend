# Foundation Audit — Pre-Monorepo Restructure

Snapshot taken before reorganising the backend into a pnpm/npm-workspaces monorepo.

## Current src/ layout (pre-move)

| Path | Role |
|---|---|
| src/index.js | Express app bootstrap (220 lines): CORS, security headers, request id, JSON body parsing with Razorpay raw-body capture, route wiring, error handler, server lifecycle |
| src/app.js | Re-exports `app` from index — used by tests |
| src/server.js | Starts server via `startServer()` from index |
| src/prisma.js | Prisma client factory (`createPrismaClient`) |
| src/seed.js | DB seeding script |
| src/config/env.js | Environment variable validation |
| src/config/rateLimiters.js | Rate limit definitions |
| src/lib/asyncHandler.js | Async route wrapper |
| src/lib/constants.js | App-wide constants |
| src/lib/helpers.js | Misc helpers including `logRouteError` |
| src/lib/logger.js | Pino logger |
| src/lib/redis.js | Redis connect/disconnect helpers |
| src/lib/response.js | `v1err` / `v1ok` response envelopes |
| src/middlewares/auth.middleware.js | JWT auth + role checks |
| src/middlewares/error.middleware.js | Error formatter |
| src/middlewares/rateLimit.middleware.js | Rate limit middleware |
| src/middlewares/requestId.middleware.js | Request id middleware |
| src/modules/auth/auth.routes.js | /api/v1 customer + restaurant auth |
| src/modules/orders/order.routes.js | /api/v1 orders |
| src/modules/payments/payment.routes.js | /api/v1 payments |
| src/modules/public/public.routes.js | /api/v1 public restaurant/menu/lookup |
| src/modules/restaurants/restaurant.routes.js | /api/v1 restaurant ops |
| src/modules/webhooks/webhook.routes.js | Razorpay webhooks (`/webhooks/razorpay`) — requires raw body |
| src/modules/deviceTokens/deviceToken.routes.js | /api/v1 device push token registration |
| src/modules/legacy/auth.legacy.routes.js | Legacy `/auth/*` routes used by static public/ HTML pages |
| src/modules/legacy/public.legacy.routes.js | Legacy public routes (menu, restaurant by slug) |
| src/modules/legacy/customer.legacy.routes.js | Legacy customer routes |
| src/modules/legacy/admin.legacy.routes.js | Legacy admin/restaurant routes |
| src/modules/legacy/payment.legacy.routes.js | Legacy payment routes |
| src/modules/legacy/otp.helpers.js | Shared OTP helpers used by webCompat auth + password reset |
| src/routes/health.routes.js | `/health` probes |
| src/routes/web.routes.js | Static HTML shell routes (`/`, `/r/:slug`, `/track`, `/privacy`, etc.) |
| src/routes/legacy.routes.js | Aggregator for all legacy modules |
| src/routes/v1.routes.js | Aggregator for /api/v1 modules |
| src/serializers/menu.serializer.js | Public menu shape |
| src/serializers/order.serializer.js | Public order shape (hides internal IDs) |
| src/services/abuse.service.js | Abuse / fraud counters |
| src/services/auth.service.js | Token issuance |
| src/services/notification.service.js | OTP + order emails (Resend / log) |
| src/services/order.service.js | Order create/transition logic |
| src/services/rating.service.js | Order rating logic |
| src/utils/money.js | Currency helpers |
| src/utils/phone.js | Phone validation |
| src/utils/token.js | Tracking / menu key generation |
| src/jobs/worker.js | BullMQ worker entrypoint |
| src/jobs/cleanup.jobs.js | Cleanup jobs |
| src/jobs/notification.jobs.js | Notification jobs |
| src/jobs/payment.jobs.js | Payment reconcile jobs |
| src/jobs/queues.js | BullMQ queue definitions |

## What appears unused
No clearly dead modules — every file under `src/` is reachable from `index.js`, `routes/v1.routes.js`, `routes/legacy.routes.js`, or `jobs/worker.js`. The legacy/webCompat modules are still in active use by the static `public/` HTML shell and must NOT be removed.

## What is safe to delete now
- `.tmp-screens/*.png` — temporary screenshots, never referenced from code. Untracked in this restructure; remains on disk for local use.
- No other deletions in this pass.

## What must be kept temporarily
- `apps/api/src/modules/webCompat/*` — all five route files. Renamed from `legacy/*` for clarity but still mounted in production. They are the only thing serving the static `apps/api/public/` HTML pages.
- `apps/api/src/routes/web.routes.js` — static HTML shell router, also required for `public/`.
- `apps/api/public/*` — static frontend. Will be deleted only after Next.js apps are deployed and verified (see `docs/architecture/STATIC_WEB_MIGRATION.md`).

## What "legacy" routes are
The webCompat (formerly `legacy/`) routes are NOT dead code — they are the API surface consumed by the current static HTML frontend in `public/`. Every page in `public/` (menu.html, customer-login.html, admin/*.html, etc.) calls these endpoints. They are renamed to `webCompat` to signal that they are a compatibility layer for the static web shell during migration to Next.js, not deprecated code.

The new Next.js apps and Expo mobile apps must consume `/api/v1/*` exclusively.

## What routes are active under /api/v1
Mounted in `src/routes/v1.routes.js`:

- `/api/v1/customer/auth/*` and `/api/v1/restaurant/auth/*` — login/signup/me
- `/api/v1/public/restaurants/:slug` — restaurant info
- `/api/v1/public/restaurants/:slug/menu` — menu items
- `/api/v1/public/orders/lookup` — tracking by token
- `/api/v1/customer/orders` — create/list/get/cancel/rate
- `/api/v1/restaurant/orders` — restaurant operations
- `/api/v1/customer/payments/razorpay/create` + `/api/v1/customer/payments/upi/claim`
- `/api/v1/restaurant/*` — subscription, menu availability
- `/api/v1/*/device-tokens` — push notification registration

The webhook route `/webhooks/razorpay` is mounted outside `/api/v1` because Razorpay calls it directly with a signed payload — the raw body is captured in `index.js` before JSON parsing for HMAC verification.

## Risks during restructure
1. **publicDir path drift** — `src/index.js` (`path.join(__dirname, "../public")`) and `src/routes/web.routes.js` (`path.join(__dirname, "..", "..", "public")`) both expect specific relative locations of the `public/` directory. After moving src/ and public/ together under `apps/api/`, the relative paths still resolve correctly (verified manually + by test run).
2. **Razorpay raw-body verify** — the `verify` callback in `express.json()` writes `req.rawBody` before JSON parsing. Webhook signature verification depends on this. The middleware is unchanged by the move.
3. **node_modules resolution** — node_modules stays at the repository root. Node walks up the directory tree from `apps/api/src/` to find it. Tests confirmed this works.
4. **prisma.config.ts location** — moved into `apps/api/`. Prisma CLI run from `apps/api/` finds `prisma/schema.prisma` relatively.
5. **Test imports** — tests use `require("../src/index")`. They were moved together (`tests/` → `apps/api/tests/`, `src/` → `apps/api/src/`), so the relative path is preserved.
6. **Legacy URL contracts** — renaming the directory and files does not change any URL path. Routes are still mounted via the same aggregator and use the same `router.get(...)` paths inside each module.
7. **CI / Render deployment** — root scripts now delegate to `apps/api` via `npm --prefix`. Render start command must change to `node apps/api/src/server.js` or use the new `npm run api:start`.

## Test baseline
6 test suites, 43 tests passing pre-move. Same count passing after move and after webCompat rename. No new tests added in this restructure.

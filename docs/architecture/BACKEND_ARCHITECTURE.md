# Avenzo Backend Architecture

## 1. Project Overview

Avenzo is a production-bound restaurant/customer dine-in ordering platform. The backend is an Express.js/Node.js server backed by PostgreSQL (via Prisma ORM), Redis (rate limiting), and BullMQ (background jobs).

The platform has three shells:
1. **Public shell** — QR-code menu pages, order tracking, restaurant interest form
2. **Customer shell** — Signed-in customer accounts, order history, profile
3. **Restaurant/Admin shell** — Partner dashboard, kitchen view, menu management, staff management

---

## 2. Final Folder Structure

```
src/
├── index.js                        # App entry point (slim, ~220 lines)
├── app.js                          # Re-export for tests
├── server.js                       # Standalone server runner
├── prisma.js                       # Prisma client singleton factory
│
├── routes/
│   ├── health.routes.js            # GET /health, GET /ready
│   ├── web.routes.js               # Static HTML page routes (/r/:slug, /track/:token, etc.)
│   ├── legacy.routes.js            # Aggregator for all legacy routes
│   └── v1.routes.js                # /api/v1 router (composes sub-modules)
│
├── modules/
│   ├── legacy/
│   │   ├── otp.helpers.js          # OTP generation, hashing, challenge creation
│   │   ├── auth.legacy.routes.js   # POST /auth/*, GET /auth/*
│   │   ├── public.legacy.routes.js # GET /restaurant/*, GET /menu/*, POST /order, etc.
│   │   ├── customer.legacy.routes.js # GET/PATCH /customer/*
│   │   ├── admin.legacy.routes.js  # GET/POST/PUT/DELETE /restaurants, /menu, /admin/*
│   │   └── payment.legacy.routes.js # GET/POST /payment/*, /admin/payment-methods/*
│   ├── auth/
│   │   └── auth.routes.js          # /api/v1 customer + restaurant auth
│   ├── orders/
│   │   └── order.routes.js         # /api/v1 customer + restaurant orders
│   ├── payments/
│   │   └── payment.routes.js       # /api/v1 payments
│   ├── public/
│   │   └── public.routes.js        # /api/v1 public endpoints
│   ├── restaurants/
│   │   └── restaurant.routes.js    # /api/v1 restaurant management
│   ├── webhooks/
│   │   └── webhook.routes.js       # /webhooks/razorpay
│   └── deviceTokens/
│       └── deviceToken.routes.js   # Device token management
│
├── services/
│   ├── auth.service.js             # JWT, auth helpers, restaurant access, audit log
│   ├── order.service.js            # Popular menu IDs, payment methods, idempotency
│   ├── notification.service.js     # Email/SMS/OTP notifications
│   ├── abuse.service.js            # Order abuse detection
│   └── rating.service.js          # submitRating
│
├── middlewares/
│   ├── auth.middleware.js          # authMiddleware, optionalAuth, v1Auth, v1OptionalAuth
│   ├── rateLimit.middleware.js     # createRateLimiter factory
│   ├── error.middleware.js         # Global error handler
│   └── requestId.middleware.js     # X-Request-ID header
│
├── serializers/
│   ├── order.serializer.js         # publicOrderResponse, customerOrderSummary
│   └── menu.serializer.js          # publicMenuItem, adminMenuItem
│
├── config/
│   ├── rateLimiters.js             # All Redis-backed rate limiter instances
│   └── env.js                      # Env var validation
│
├── lib/
│   ├── helpers.js                  # Pure helper functions (normalizeSlug, cleanString, etc.)
│   ├── constants.js                # Shared enums (JWT_ISSUER, FOOD_TYPES, etc.)
│   ├── response.js                 # v1ok, v1err, v1list response envelopes
│   ├── asyncHandler.js             # Async route wrapper
│   └── redis.js                    # Redis client singleton
│
├── utils/
│   ├── money.js                    # rupeesToPaise, paiseToRupees
│   ├── token.js                    # publicMenuKey
│   └── phone.js                    # normalizePhone, isValidPhone
│
└── jobs/
    ├── queues.js                   # BullMQ queue definitions
    ├── worker.js                   # BullMQ worker entry point
    ├── notification.jobs.js        # Notification job processors
    ├── payment.jobs.js             # Payment job processors
    └── cleanup.jobs.js             # Cleanup job processors
```

---

## 3. App Startup Flow

1. `src/index.js` loads — `require("dotenv").config()`
2. Express app created: `const app = express()`
3. Trust proxy configured (Render/Railway/etc.)
4. JWT_SECRET validated — throws if missing
5. CORS middleware registered (reads CORS_ORIGINS env)
6. Request ID middleware registered (attaches X-Request-ID)
7. Security headers middleware registered (CSP, HSTS, etc.)
8. `express.json` registered with raw body capture for Razorpay webhooks
9. `express.static` registered for public/ directory
10. Route modules mounted in order (see section 4)
11. 404 catch-all middleware registered
12. Global error handler registered
13. `startServer()` called — connects Redis, starts HTTP listener

---

## 4. Route Mounting Flow

```
app.use(health.routes)       → GET /health, GET /ready
app.use(web.routes)          → Static HTML pages
app.use(legacy.routes)       → All legacy API endpoints (see section 7)
app.use("/webhooks", ...)    → POST /webhooks/razorpay
app.use("/api/v1", ...)      → All v1 API endpoints (see section 6)
app.use(404 catch-all)
app.use(error handler)
```

---

## 5. Static Web Routes

Served by `web.routes.js`:

| Path | File |
|---|---|
| `/r/:slug` | `public/menu.html` |
| `/track/:token` | `public/track.html` |
| `/customer-login.html` | `public/customer-login.html` |
| `/customer-signup.html` | `public/customer-signup.html` |
| `/customer-orders.html` | `public/customer-orders.html` |
| `/customer-profile.html` | `public/customer-profile.html` |
| `/restaurant-login.html` | `public/restaurant-login.html` |

---

## 6. /api/v1 Routes

All routes are prefixed `/api/v1`.

**Customer Auth** (`/api/v1/customer/auth/`):
- `POST /customer/auth/signup`
- `POST /customer/auth/login`
- `GET /customer/auth/me`

**Restaurant Auth** (`/api/v1/restaurant/auth/`):
- `POST /restaurant/auth/login`
- `GET /restaurant/me`

**Public** (`/api/v1/public/`):
- `GET /public/restaurant/:slug`
- `GET /public/menu/:menuKey`
- `POST /public/order`

**Orders** (`/api/v1/`):
- `GET /orders/:restaurantId` — Restaurant order list
- `PATCH /orders/:id/status` — Restaurant order status update

**Payments** (`/api/v1/`):
- `POST /payments/create`
- `POST /payments/upi-confirm`

**Restaurants** (`/api/v1/`):
- Restaurant management endpoints

---

## 7. Legacy Routes

These routes are preserved for backward compatibility. All responses are identical to the original implementation.

| Legacy Route | V1 Equivalent |
|---|---|
| `POST /auth/customer/signup` | `POST /api/v1/customer/auth/signup` |
| `POST /auth/customer/login` | `POST /api/v1/customer/auth/login` |
| `POST /auth/restaurant/login` | `POST /api/v1/restaurant/auth/login` |
| `POST /auth/google` | `POST /api/v1/customer/auth/google` |
| `GET /auth/me` | `GET /api/v1/customer/auth/me` |
| `GET /restaurant/slug/:slug` | `GET /api/v1/public/restaurant/:slug` |
| `GET /menu/:restaurantId` | `GET /api/v1/public/menu` |
| `POST /order` | `POST /api/v1/public/order` |
| `GET /order/:trackingToken` | `GET /api/v1/public/order/:trackingToken` |
| `GET /customer/profile` | `GET /api/v1/me` |
| `GET /customer/orders` | `GET /api/v1/customer/orders` |

---

## 8. Auth Module

- **JWT** — HS256, issuer `avenzo-api`, audience `avenzo-admin`, 7d expiry
- **Customer login** — Password or Google SSO; optional 2FA via OTP
- **Restaurant login** — Password only; optional 2FA via OTP
- **Middleware** — `authMiddleware` (required), `optionalAuth` (guest-safe), `v1Auth`, `v1OptionalAuth`
- **Roles** — `USER` (customer), `RESTAURANT_OWNER`, `EMPLOYEE`, `ADMIN`

---

## 9. Orders Module

- Order creation validates restaurant availability, phone number, menu items, and payment method
- Payment guard: orders with `PAYMENT_PENDING` or `PAYMENT_CLAIMED` status block kitchen progression
- Idempotency: DB-backed idempotency keys prevent duplicate orders on retry
- Abuse detection: IP + phone + device fingerprint rate limiting via `abuse.service.js`
- Tracking: public order tracking uses `trackingToken` only — no internal IDs exposed

---

## 10. Payments Module

- **Razorpay** — Orders created server-side; webhook verifies payment via HMAC-SHA256
- **UPI QR** — Customer claims payment (`PAYMENT_CLAIMED`); restaurant staff confirms (`PAID`)
- **Manual confirm** — `POST /admin/order/:id/confirm-payment` marks UPI orders as paid
- Payment safety rule: kitchen cannot proceed while `paymentStatus` is `PAYMENT_PENDING` or `PAYMENT_CLAIMED`

---

## 11. Webhooks Module

- `POST /webhooks/razorpay`
- Raw body captured before JSON parsing via `express.json verify` hook
- HMAC-SHA256 signature verified with `RAZORPAY_WEBHOOK_SECRET`
- Duplicate events deduplicated by `razorpayPaymentId`
- Successful payment sets `paymentStatus = PAID` and triggers order confirmation notification

---

## 12. Restaurant/Menu Modules

- Restaurant access controlled by `getRestaurantAccess()` — returns `canAccess`, `canManage`, `canOperate`
- `ensureWorkspaceService()` blocks operators from acting on expired/suspended restaurants (admins can still access)
- Food type compatibility enforced: PURE_VEG restaurants cannot have NON_VEG items
- Category sort order managed via `PATCH /admin/categories/:restaurantId/reorder`

---

## 13. Redis Rate Limiting

Rate limiters live in `src/config/rateLimiters.js`. Each limiter is created with `createRateLimiter()` from `src/middlewares/rateLimit.middleware.js`.

| Limiter | Window | Max | Namespace |
|---|---|---|---|
| `authLimiter` | 15 min | 30 | auth |
| `orderLimiter` | 1 min | 20 | order |
| `orderLookupLimiter` | 1 min | 12 | olookup |
| `trackingLimiter` | 1 min | 60 | track |
| `restaurantInterestLimiter` | 60 min | 8 | rint |
| `otpLimiter` | 10 min | 12 | otp |
| `passwordResetLimiter` | 15 min | 5 | pwreset |
| `paymentLimiter` | 1 min | 15 | payment |

If Redis is unavailable, limiters fall back to an in-memory Map.

---

## 14. BullMQ Jobs

Job queues are defined in `src/jobs/queues.js`. The worker entry point is `src/jobs/worker.js`.

Job types:
- **Notification jobs** — Email/SMS order confirmation and status update notifications
- **Payment jobs** — Async Razorpay reconciliation
- **Cleanup jobs** — Expired idempotency keys, old OTP challenges

To run the worker:
```bash
node src/jobs/worker.js
```

---

## 15. Prisma/DB Layer

- Singleton Prisma client created via `createPrismaClient()` in `src/prisma.js`
- Supabase pooler connections use `@prisma/adapter-pg` with libpq-compatible SSL
- **Never use `prisma db push`** — use migrations only
- Migration commands:
  ```bash
  npx prisma migrate dev --name <migration-name>  # development
  npx prisma migrate deploy                        # production
  ```

---

## 16. How to Add a New Endpoint

1. Decide which module it belongs to (auth, orders, payments, restaurants, public)
2. Add the route to the appropriate module file in `src/modules/<module>/<module>.routes.js`
3. If it's a new v1 endpoint, mount it in `src/routes/v1.routes.js`
4. If it's a legacy route, add it to the appropriate file in `src/modules/legacy/`
5. Add any new helper functions to `src/lib/helpers.js` or a service file
6. Add rate limiting via `src/config/rateLimiters.js` if needed
7. Run tests and syntax checks before committing

---

## 17. How to Run Tests

```bash
npm test -- --forceExit
```

Tests are in the `tests/` directory. Jest configuration is in `package.json`.

Setup file (`tests/setup.js`) sets required env vars before any module is loaded.

---

## 18. How to Run Worker

```bash
node src/jobs/worker.js
```

The worker requires `REDIS_URL` and `DATABASE_URL` to be set.

---

## 19. Deployment Notes

- Set `NODE_ENV=production`
- Set `JWT_SECRET` to a secure random string (minimum 32 characters)
- Set `DATABASE_URL` and `DIRECT_URL` for Supabase/PostgreSQL
- Set `REDIS_URL` for Redis (rate limiting)
- Set `CORS_ORIGINS` to your frontend domain(s), comma-separated
- Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` for payments
- Set `GOOGLE_CLIENT_ID` for Google SSO
- Run `npx prisma migrate deploy` before starting the server
- The server runs on `PORT` (default 5000)
- Trust proxy is enabled — ensure your reverse proxy sets `X-Forwarded-For`

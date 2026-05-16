# Environment Variables Guide

## Principles
- API secrets are **server-only** — never put them in `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`
- `NEXT_PUBLIC_*` is bundled into the Next.js client build — visible to end users
- `EXPO_PUBLIC_*` is bundled into the Expo app binary — visible to end users
- Never put `JWT_SECRET`, `DATABASE_URL`, or Razorpay secrets in any client env

## No .env on Render
Render injects environment variables directly from the dashboard.
Do **not** upload a `.env` file to Render.
`apps/api/.env` is for **local development only**.

---

## Render Deployment Settings

**Service type**: Web Service
**Root Directory**: *(leave blank — repo root)*
**Build Command**: `npm run render:build`
**Start Command**: `node apps/api/src/server.js`
**Health Check Path**: `/health`

---

## Required Render environment variables

Set all of these in the Render dashboard → Environment tab:

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | ✓ | Set to `production` |
| `PORT` | optional | Render sets this automatically |
| `DATABASE_URL` | ✓ | pgBouncer pooled URL (port 6543) |
| `DIRECT_URL` | ✓ | Direct Postgres URL (port 5432) for migrations |
| `JWT_SECRET` | ✓ | Min 64 chars — `openssl rand -hex 64` |
| `APP_BASE_URL` | ✓ | Your Render service URL, e.g. `https://avenzo-api.onrender.com` |
| `CORS_ORIGINS` | ✓ | Comma-separated allowed origins, no wildcard |
| `REDIS_URL` | ✓ | `rediss://default:PASSWORD@HOST:PORT` (Upstash TLS) |
| `RAZORPAY_KEY_ID` | ✓ | Must be `rzp_live_...` in production |
| `RAZORPAY_KEY_SECRET` | ✓ | |
| `RAZORPAY_WEBHOOK_SECRET` | ✓ | From Razorpay dashboard → Webhooks |
| `GOOGLE_CLIENT_ID` | ✓ | For Google Sign-In |
| `RESEND_API_KEY` | ✓ | From Resend dashboard |
| `FROM_EMAIL` | ✓ | Verified sender domain |
| `SUPPORT_EMAIL` | recommended | |
| `OTP_MODE` | ✓ | Must be `email` in production (not `log`) |
| `NOTIFICATION_MODE` | ✓ | `email` or `log` |
| `LOG_LEVEL` | optional | `info` (default). `debug` for verbose logging |
| `WORKER_CONCURRENCY` | optional | BullMQ worker concurrency (default varies) |
| `SENTRY_DSN` | recommended | Error tracking |

---

## Per-app local .env.example locations

| App | .env.example |
|---|---|
| API (backend) | `apps/api/.env.example` |
| Customer web | `apps/customer-web/.env.example` |
| Restaurant web | `apps/restaurant-web/.env.example` |
| Customer mobile | `apps/customer-mobile/.env.example` |
| Restaurant mobile | `apps/restaurant-mobile/.env.example` |

---

## apps/api — local development

Copy `apps/api/.env.example` to `apps/api/.env` and fill in values.

All Prisma commands (`prisma:validate`, `prisma:migrate:deploy`, `prisma:generate`) read
the `.env` from `apps/api/` when run via `npm --prefix apps/api run ...`.

---

## apps/customer-web
```
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxx
```

## apps/restaurant-web
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## apps/customer-mobile + apps/restaurant-mobile
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:5000
EXPO_PUBLIC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxx
```

> Note: Use your local machine's LAN IP (not localhost) for mobile simulators/devices.

---

## Worker service (separate Render service)

If running the BullMQ worker as a separate Render service:

**Build Command**: `npm run render:build`
**Start Command**: `node apps/api/src/jobs/worker.js`

Requires all the same env vars as the API, plus `REDIS_URL`.

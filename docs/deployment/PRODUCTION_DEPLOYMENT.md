# Production Deployment — Avenzo Backend

## Repository structure
The backend lives at `apps/api/` inside the monorepo.
All Render commands must target `apps/api` explicitly — see below.

## Prerequisites
- Node.js 20+ (LTS)
- PostgreSQL 14+ via Supabase (pgBouncer pooler + direct URL)
- Redis (Upstash recommended for serverless; hosted Redis for dedicated)
- Razorpay live account with webhook secret
- Resend account with verified domain

## Environment variables
Set these in the Render dashboard → Environment.
Copy `apps/api/.env.example` as a reference.

**Required in production (app will refuse to start without these):**
- `DATABASE_URL` — pooled connection string (pgBouncer, port 6543)
- `DIRECT_URL` — direct connection string (port 5432), used by Prisma migrations
- `JWT_SECRET` — minimum 64 random characters (`openssl rand -hex 64`)
- `RAZORPAY_KEY_ID` — must be a live key (`rzp_live_...`)
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` — from Razorpay dashboard → Webhooks
- `REDIS_URL` — `rediss://default:PASSWORD@HOST:PORT` for Upstash
- `OTP_MODE=email` — OTP_MODE=log is blocked in production
- `RESEND_API_KEY` — from Resend dashboard
- `FROM_EMAIL` — verified sender domain
- `CORS_ORIGINS` — comma-separated allowed origins (no wildcard)

## Render deployment commands

### Build Command
```
npm run render:build
```

This runs (defined in root `package.json`):
```
npm install --prefix apps/api && npm --prefix apps/api run prisma:migrate:deploy && npm --prefix apps/api run prisma:generate
```

### Start Command
```
node apps/api/src/server.js
```

### Health check path
```
/health
```

### Readiness probe (if supported)
```
/ready
```

## What each build step does
1. `npm install --prefix apps/api` — installs all backend dependencies into `apps/api/node_modules`
2. `npm --prefix apps/api run prisma:migrate:deploy` — applies any pending DB migrations
3. `npm --prefix apps/api run prisma:generate` — regenerates the Prisma client

> **Never use `prisma db push`** — it bypasses migration history.

## Worker service (separate Render service)
If running BullMQ worker as a separate service:

Start Command:
```
node apps/api/src/jobs/worker.js
```

Build Command: same as API — `npm run render:build`

## Webhook configuration (Razorpay)
- URL: `https://your-domain.com/webhooks/razorpay`
- Events: `payment.captured`, `payment.failed`, `order.paid`
- Copy the webhook secret to `RAZORPAY_WEBHOOK_SECRET`

## Redis setup (Upstash)
1. Create a free Upstash Redis database
2. Copy the `rediss://` connection string to `REDIS_URL`
3. Rate limiting degrades gracefully if Redis is unavailable, but this is not safe in production under load

## Security checklist
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` is at least 64 characters and is NOT the placeholder
- [ ] `RAZORPAY_KEY_ID` starts with `rzp_live_` (not `rzp_test_`)
- [ ] `OTP_MODE=email` (never `log`)
- [ ] `CORS_ORIGINS` lists only your actual frontend domains
- [ ] `SENTRY_DSN` is set for error tracking
- [ ] HTTPS is enforced (Render enforces this automatically)

## Monitoring
- `/health` — liveness probe (no DB query, always fast)
- `/ready` — readiness probe (queries DB, returns 503 if down)
- Slow requests (>1s) are logged with `"msg":"Slow request"` to stdout
- Sentry captures unhandled errors when `SENTRY_DSN` is set

## Future pnpm migration
Once pnpm is installed:
```
# Build Command
pnpm install --frozen-lockfile && pnpm --filter @avenzo/api prisma:migrate:deploy && pnpm --filter @avenzo/api prisma:generate

# Start Command
node apps/api/src/server.js
```

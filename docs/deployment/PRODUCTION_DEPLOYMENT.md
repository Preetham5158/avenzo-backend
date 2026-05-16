# Production Deployment - Avenzo Backend

## Repository Structure

The production backend runtime lives at `apps/api/` inside the monorepo. Render should run commands from the repository root and use the root npm workspace scripts.

## Prerequisites

- Node.js 20+ LTS.
- PostgreSQL 14+ via Supabase or another managed PostgreSQL provider.
- Redis, such as Upstash or hosted Redis.
- Razorpay live account with webhook secret.
- Resend account with verified domain.

## Environment Variables

Set these in the Render dashboard environment settings. Copy `apps/api/.env.example` as a reference.

Required in production:

- `DATABASE_URL` - pooled connection string for runtime queries.
- `DIRECT_URL` - direct connection string for Prisma migrations.
- `JWT_SECRET` - minimum 64 random characters.
- `RAZORPAY_KEY_ID` - live key, starting with `rzp_live_`.
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `REDIS_URL`
- `OTP_MODE=email`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `CORS_ORIGINS` - comma-separated allowed origins.

Backend secrets must stay backend-only. Frontend and mobile apps should receive only public API base URLs.

## Render Deployment Commands

Build Command:

```bash
npm run render:build
```

Start Command:

```bash
node apps/api/src/server.js
```

Health check path:

```text
/health
```

Readiness probe, if supported:

```text
/ready
```

## What render:build Does

`render:build` is defined in the root `package.json` and currently runs:

```bash
npm run api:prisma:migrate:deploy && npm run api:prisma:generate
```

Render should install dependencies from the monorepo root before running the build command. The build command then applies pending Prisma migrations and regenerates Prisma Client through the root workspace scripts.

Never use `prisma db push` in production.

## Worker Service

If BullMQ workers run as a separate Render service, use the same build command as the API service.

Worker Start Command:

```bash
node apps/api/src/jobs/worker.js
```

## Webhook Configuration

- URL: `https://your-domain.com/webhooks/razorpay`
- Events: `payment.captured`, `payment.failed`, `order.paid`
- Copy the webhook secret to `RAZORPAY_WEBHOOK_SECRET`.

## Security Checklist

- `NODE_ENV=production`
- `JWT_SECRET` is strong and not a placeholder.
- `RAZORPAY_KEY_ID` starts with `rzp_live_`.
- `OTP_MODE=email`
- `CORS_ORIGINS` lists only real frontend domains.
- `SENTRY_DSN` is set if production error tracking is enabled.
- HTTPS is enforced by the platform.

## Monitoring

- `/health` - liveness probe.
- `/ready` - readiness probe.
- Slow requests are logged to stdout.
- Sentry captures unhandled errors when `SENTRY_DSN` is set.

## Static Compatibility Note

`apps/api/public` and `webCompat` routes are still required until `apps/customer-web` and `apps/restaurant-web` replace the static pages and parity is tested.

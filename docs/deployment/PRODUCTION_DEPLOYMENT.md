# Production Deployment — Avenzo Backend

## Prerequisites
- Node.js 20+ (LTS)
- PostgreSQL 14+ via Supabase (pgBouncer pooler + direct URL)
- Redis (Upstash recommended for serverless; hosted Redis for dedicated)
- Razorpay live account with webhook secret
- Resend account with verified domain

## Environment variables
Copy `.env.example` to `.env` and fill in all values.

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

## Database migrations
Always run migrations before deploying new code:
```bash
npm run prisma:migrate:deploy
npm run prisma:generate
```
Never run `prisma db push` on production — it bypasses migration history.

## Deploying on Render
1. Set all env vars in Render dashboard → Environment
2. Build command: `npm install && npm run prisma:migrate:deploy && npm run prisma:generate`
3. Start command: `npm start`
4. Health check path: `/health`
5. Add `/ready` as a readiness probe if supported

## Webhook configuration (Razorpay)
- URL: `https://your-domain.com/webhooks/razorpay`
- Events to enable: `payment.captured`, `payment.failed`, `order.paid`
- Copy the webhook secret to `RAZORPAY_WEBHOOK_SECRET`

## Redis setup (Upstash)
1. Create a free Upstash Redis database
2. Copy the `rediss://` connection string to `REDIS_URL`
3. Rate limiting and caching degrade gracefully if Redis is unavailable, but this is not safe for production under load

## Security checklist
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` is at least 64 characters and is NOT the placeholder
- [ ] `RAZORPAY_KEY_ID` starts with `rzp_live_` (not `rzp_test_`)
- [ ] `OTP_MODE=email` (never `log`)
- [ ] `CORS_ORIGINS` lists only your actual frontend domains
- [ ] `SENTRY_DSN` is set for error tracking
- [ ] HTTPS is enforced (Render/Vercel enforce this automatically)

## Monitoring
- `/health` — liveness probe (no DB query, always fast)
- `/ready` — readiness probe (queries DB, returns 503 if down)
- Slow requests (>1s) are logged with `"msg":"Slow request"` to stdout
- Sentry captures unhandled errors when `SENTRY_DSN` is set

# Launch Checklist — Avenzo Pilot

Use this before allowing real customers to place orders.

## Infrastructure
- [ ] Supabase project created, DATABASE_URL + DIRECT_URL configured
- [ ] Redis provisioned (Upstash free tier is sufficient for pilot)
- [ ] Render/fly.io service deployed and healthy at `/health`
- [ ] Custom domain configured with HTTPS
- [ ] Razorpay live keys obtained and set (`rzp_live_...`)
- [ ] Razorpay webhook registered pointing to `/webhooks/razorpay`
- [ ] Resend account verified, `FROM_EMAIL` domain is verified

## Environment
- [ ] `NODE_ENV=production`
- [ ] `OTP_MODE=email` (not `log`)
- [ ] `NOTIFICATION_MODE=email` (not `log`)
- [ ] `JWT_SECRET` is a real 64-char random string
- [ ] `RAZORPAY_WEBHOOK_SECRET` matches Razorpay dashboard
- [ ] `CORS_ORIGINS` set to actual frontend URL(s) only

## Database
- [ ] All migrations applied: `npx prisma migrate status`
- [ ] At least one admin user created
- [ ] At least one restaurant created with a valid slug
- [ ] Test menu items with correct prices (paise) visible on public menu

## Functional smoke test
- [ ] Public menu loads at `/r/:slug`
- [ ] Guest order can be placed (no login, phone required)
- [ ] Logged-in customer order attaches to account
- [ ] Order tracking works via tracking token URL
- [ ] Restaurant Partner login works
- [ ] KDS (kitchen display) shows new orders in real time
- [ ] UPI / QR payment flow completes end-to-end
- [ ] Razorpay online payment flow completes end-to-end
- [ ] Webhook delivers and marks order PAID (check `/admin/orders`)
- [ ] OTP is received by email (not just logged)

## Security
- [ ] Admin pages redirect to login when no token is present
- [ ] Customer cannot access `/admin/*` pages
- [ ] Guest order does NOT appear in customer account automatically
- [ ] Public menu does not expose internal IDs (check browser Network tab)
- [ ] Rate limiting is active (test with curl: more than 30 auth requests in 15min returns 429)

## Mobile / responsive
- [ ] Public menu usable at 360px
- [ ] Customer order flow usable at 360px
- [ ] Admin KDS usable at 768px tablet

## Monitoring
- [ ] Sentry DSN configured and receiving test errors
- [ ] `/ready` returns 200
- [ ] Startup log contains port and env

## Go/no-go
Only proceed to real customer traffic after all boxes are checked.

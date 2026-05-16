# Avenzo Deployment Checklist

## Branch Flow

1. Merge tested work from `develop` into `main`.
2. Render deploys production from `main`.
3. Do not push directly to `main`.

## Prisma Production Rule

Never run `prisma db push` on production.

Use migrations:

```bash
npx prisma migrate deploy
```

## Render Commands

Build Command:

```bash
npm install && npx prisma generate
```

Start Command:

```bash
npx prisma migrate deploy && npm start
```

## Required Environment Variables

### Core
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `BASE_URL`
- `ENABLE_BOOTSTRAP_SCHEMA=false`

### Authentication — 2FA (Production)
- `AUTH_REQUIRE_RESTAURANT_2FA=true`
- `AUTH_REQUIRE_CUSTOMER_2FA=true`
- `OTP_TTL_MINUTES=10`
- `OTP_MAX_ATTEMPTS=5`

> **Local / development defaults**: `AUTH_REQUIRE_RESTAURANT_2FA=false`, `AUTH_REQUIRE_CUSTOMER_2FA=false`, `OTP_MODE=log`, `NOTIFICATION_MODE=log`.
> Do not copy production flags into your local `.env` unless you are specifically testing the full OTP email flow.

### Email — Resend
- `OTP_MODE=email`
- `NOTIFICATION_MODE=email`
- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=re_...` (from Resend dashboard — do not commit)
- `FROM_EMAIL=Avenzo <no-reply@avenzo.app>` (domain `avenzo.app` must be verified in Resend)
- `SUPPORT_EMAIL=support@avenzo.app`

> **Never set `OTP_MODE=log` in production.** Log mode is blocked in `NODE_ENV=production`.

## Before Production Migration

- Confirm a current database backup exists.
- Confirm the target database is the live database.
- Confirm the deployment branch is latest `main`.
- Confirm migrations were tested from `develop`.
- Run `npx prisma migrate status` against the intended target.

## Existing Database Baseline Note

If Prisma reports that the existing production database needs a baseline, do not use `db push`.

Carefully resolve only the already-applied baseline migration:

```bash
npx prisma migrate resolve --applied 20260510000000_baseline
```

Only do this after confirming the production schema already matches that baseline migration.

## Live Smoke Test

- Customer login requires OTP email (code delivered to inbox, not logged to console).
- Restaurant/admin login requires OTP email.
- `USER` account is blocked from restaurant login.
- Admin dashboard lists restaurants.
- Customer signup/login lands on the customer home.
- Public menu loads for an active restaurant.
- Order creation returns a `trackingToken`.
- Order confirmation email received for logged-in customer order.
- Tracking URL works and does not expose internal order IDs.
- Admin can update order status; READY and CANCELLED send status emails.
- Expired or suspended restaurants block public ordering.
- Expired or suspended restaurants block owner/employee operations.
- Restaurant interest form saves a lead.
- `node scripts/smoke-test.js` passes and cleans up its temporary role fixtures.
- Public menu and tracking responses do not expose internal IDs.

## Rollback Notes

- Roll back app code and database migrations together.
- Do not rollback migrations that have already been depended on by production writes without a data plan.

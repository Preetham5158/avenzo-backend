# Avenzo Deployment Checklist

## Branch Flow

1. Merge tested work from `develop` into `main`.
2. Render deploys production from `main`.
3. Do not push directly to `main`.

## Prisma Production Rule

Never run `prisma db push` on production.

Use migrations:

```bash
npm run api:prisma:migrate:deploy
```

## Render Commands

Build Command:

```bash
npm run render:build
```

Start Command:

```bash
node apps/api/src/server.js
```

Render should run these from the monorepo root after installing dependencies with npm.

## Required Environment Variables

### Core

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `BASE_URL`
- `ENABLE_BOOTSTRAP_SCHEMA=false`

### Authentication - 2FA

- `AUTH_REQUIRE_RESTAURANT_2FA=true`
- `AUTH_REQUIRE_CUSTOMER_2FA=true`
- `OTP_TTL_MINUTES=10`
- `OTP_MAX_ATTEMPTS=5`

Local defaults may use `AUTH_REQUIRE_RESTAURANT_2FA=false`, `AUTH_REQUIRE_CUSTOMER_2FA=false`, `OTP_MODE=log`, and `NOTIFICATION_MODE=log`. Do not copy local defaults into production.

### Email - Resend

- `OTP_MODE=email`
- `NOTIFICATION_MODE=email`
- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`
- `FROM_EMAIL=Avenzo <no-reply@avenzo.app>`
- `SUPPORT_EMAIL=support@avenzo.app`

Never set `OTP_MODE=log` in production.

## Before Production Migration

- Confirm a current database backup exists.
- Confirm the target database is the live database.
- Confirm the deployment branch is latest `main`.
- Confirm migrations were tested before production.
- Run `npm run api:prisma:migrate:status` against the intended target if checking migration state manually.

## Existing Database Baseline Note

If Prisma reports that the existing production database needs a baseline, do not use `db push`.

Carefully resolve only the already-applied baseline migration:

```bash
npm --prefix apps/api exec prisma migrate resolve --applied 20260510000000_baseline
```

Only do this after confirming the production schema already matches that baseline migration.

## Live Smoke Test

- Customer login requires OTP email.
- Restaurant/admin login requires OTP email.
- `USER` account is blocked from restaurant login.
- Admin dashboard lists restaurants.
- Customer signup/login lands on the customer home.
- Public menu loads for an active restaurant.
- Order creation returns a `trackingToken`.
- Order confirmation email is received for logged-in customer order.
- Tracking URL works and does not expose internal order IDs.
- Admin can update order status.
- READY and CANCELLED send status emails.
- Expired or suspended restaurants block public ordering.
- Expired or suspended restaurants block owner/employee operations.
- Restaurant interest form saves a lead.
- `node apps/api/scripts/smoke-test.js` passes and cleans up its temporary role fixtures.
- Public menu and tracking responses do not expose internal IDs.

## Rollback Notes

- Roll back app code and database migrations together.
- Do not roll back migrations that have already been depended on by production writes without a data plan.

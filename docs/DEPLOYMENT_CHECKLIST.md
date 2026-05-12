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

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `BASE_URL`
- `ENABLE_BOOTSTRAP_SCHEMA=false`
- `AUTH_REQUIRE_RESTAURANT_2FA=true`
- `AUTH_REQUIRE_CUSTOMER_2FA=false`
- `OTP_MODE=log` only for development; configure a provider before production OTP enforcement.
- `NOTIFICATION_MODE=log` only for development/no-provider mode.

Do not commit secrets.

## Before Production Migration

- Confirm a current database backup exists.
- Confirm the target database is the Live database.
- Confirm the deployment branch is latest `main`.
- Confirm migrations were tested from `develop`.
- Run `npx prisma migrate status` against the intended target.

## Existing Database Baseline Note

If Prisma reports that the existing production database needs a baseline, do not use `db push`.

Carefully resolve only the already-applied baseline migration, for example:

```bash
npx prisma migrate resolve --applied 20260510000000_baseline
```

Only do this after confirming the production schema already matches that baseline migration.

## Live Smoke Test

- Login works for admin and assigned restaurant users.
- Admin dashboard lists restaurants.
- Customer signup/login lands on the customer placeholder.
- Public menu loads for an active restaurant.
- Order creation returns a `trackingToken`.
- Tracking URL works and does not expose internal order IDs.
- Admin can update order status.
- Expired or suspended restaurants block public ordering.
- Expired or suspended restaurants block owner/employee operations.
- Super Admin can renew subscription status/date.
- Restaurant interest form saves a lead.
- Restaurant login OTP flow works with configured provider or approved development log mode.

## Rollback Notes

- Roll back app code and database migrations together.
- Do not rollback migrations that have already been depended on by production writes without a data plan.

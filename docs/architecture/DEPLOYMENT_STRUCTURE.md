# Deployment Structure

`apps/api` is the production backend runtime. Render currently deploys the backend from `apps/api` behavior and should continue to run the backend as the single API service.

## Backend Environment

Backend-only values:

- `DATABASE_URL`
- `DIRECT_URL`
- Redis connection values
- Razorpay secrets
- JWT secrets
- webhook secrets

Frontend and mobile apps should receive only public API base URLs, such as `NEXT_PUBLIC_API_URL` or `EXPO_PUBLIC_API_URL`. Do not expose backend secrets to web or mobile clients.

## Health Checks

Keep these endpoints stable:

- `/health`
- `/ready`

## Deployment Validation

Expected deployment validation:

1. `npm install`
2. Prisma validate
3. Prisma generate
4. Prisma migrate deploy
5. backend start
6. `/health` returns 200
7. `/ready` returns expected status
8. static compatibility route still works until migrated

## Migration Command

Database migration deployment should remain clear through the root script:

```bash
npm run api:prisma:migrate:deploy
```

Render build behavior should not create a second backend or require a separate package manager.

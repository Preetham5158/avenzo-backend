# Backend Boundaries

`apps/api` is the only backend runtime for Avenzo. It owns backend behavior, Prisma, database access, migrations, jobs, services, auth, payments, webhooks, OpenAPI contracts, and deployment runtime behavior.

Target structure:

```text
apps/api/
  prisma/
    schema.prisma
    migrations/

  src/
    server.js
    index.js
    app.js
    config/
    lib/
    middlewares/
    routes/
    modules/
    services/
    serializers/
    jobs/
    utils/

  tests/
  openapi/
  scripts/
```

## Responsibilities

- Routes should stay thin and focus on HTTP concerns.
- Services contain business logic.
- Modules group domain-specific route and support code.
- Serializers shape API responses and avoid leaking internal database details.
- Jobs handle background and async work.
- Middlewares handle auth, rate limits, request shaping, and errors.
- Config handles environment and runtime configuration.
- Prisma access should be controlled and easy to reason about, not scattered randomly.
- API versioning should remain under `/api/v1` where applicable.

## Guardrails

- Do not expose internal database details directly to clients.
- Keep webhook routes stable.
- Keep payment and order logic carefully tested.
- Avoid placing business logic inside route files.
- Do not import frontend app code into `apps/api`.
- Do not move Prisma out of `apps/api`.

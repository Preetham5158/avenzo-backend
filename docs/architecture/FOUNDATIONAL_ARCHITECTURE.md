# Foundational Architecture

Avenzo is designed as a long-term monorepo, not a rushed MVP. The foundation favors clear ownership, stable API contracts, and clean boundaries between backend, web, mobile, and shared packages.

## Core Model

- There is one backend: `apps/api`.
- There is one database: PostgreSQL, accessed through Prisma owned by `apps/api`.
- Web and mobile apps are clients only.
- Frontend and mobile apps communicate through `apps/api`.
- Shared packages exist only for reusable contracts, clients, UI tokens, and config.
- The current static web layer under `apps/api/public` and the `webCompat` routes are temporary compatibility layers.

## Architecture Diagram

```text
Customer Web        Customer Mobile
     |                    |
     |                    |
Restaurant Web      Restaurant Mobile
     |                    |
     +--------- API Client --------+
                    |
                 apps/api
                    |
                  Prisma
                    |
                PostgreSQL
```

## Boundary Rules

- `apps/api` owns backend logic, Prisma, database access, migrations, jobs, routes, services, auth, payments, webhooks, and API contracts.
- Backend code should not import frontend apps.
- Frontends should not import Prisma or access database credentials.
- Mobile apps should not bypass the API.
- Shared packages should stay clean and small.
- New stable API behavior should remain under `/api/v1` where applicable.

The long-term goal is clean web and mobile applications powered by stable API contracts, with compatibility code removed only after tested replacements are ready.

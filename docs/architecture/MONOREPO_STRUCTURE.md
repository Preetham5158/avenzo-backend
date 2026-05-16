# Monorepo Structure

Target structure:

```text
apps/
  api/
  customer-web/
  restaurant-web/
  customer-mobile/
  restaurant-mobile/

packages/
  shared/
  api-client/
  ui/
  config/

docs/
```

## Apps

- `apps/api` is the only backend runtime and owns Prisma, database access, routes, jobs, services, migrations, OpenAPI files, and deployment runtime behavior.
- `apps/customer-web` is the customer-facing web app.
- `apps/restaurant-web` is the restaurant owner and staff dashboard web app.
- `apps/customer-mobile` is the customer mobile app shell.
- `apps/restaurant-mobile` is the restaurant operations mobile app shell.

## Packages

- `packages/shared` contains stable shared contracts, DTOs, enums, constants, schemas, and framework-free helpers.
- `packages/api-client` contains API calling logic for web and mobile clients.
- `packages/ui` contains design tokens and truly reusable small UI primitives.
- `packages/config` contains shared tooling configuration.

## Rules

- App-specific logic stays inside that app.
- Cross-app reusable contracts go into `packages/shared`.
- API calling logic goes into `packages/api-client`.
- UI tokens or truly reusable components go into `packages/ui`.
- Config reuse goes into `packages/config`.
- Prisma stays only in `apps/api`.
- Do not introduce another backend app.

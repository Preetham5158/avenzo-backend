# Decision Records

## ADR-001: Use Monorepo

Decision: Avenzo uses a monorepo for backend, web, mobile, packages, and docs.

Reason: A monorepo keeps related contracts, clients, and app boundaries visible together.

Consequence: Workspace boundaries must stay clear, and shared packages should be introduced only for real reuse.

## ADR-002: Use One Backend

Decision: `apps/api` is the only backend.

Reason: One backend avoids duplicated auth, payments, webhook handling, and business logic.

Consequence: No extra backend apps should be created for web or mobile clients.

## ADR-003: Use One Database

Decision: Avenzo uses one PostgreSQL database.

Reason: One database keeps consistency and ownership simple while the platform matures.

Consequence: Database access must remain centralized through `apps/api`.

## ADR-004: apps/api Owns Prisma and DB Access

Decision: Prisma schema, migrations, and Prisma Client usage belong to `apps/api`.

Reason: Central ownership prevents clients and packages from depending on database internals.

Consequence: Frontend, mobile, and shared packages must not import Prisma.

## ADR-005: npm Workspaces Are the Package Manager

Decision: Avenzo uses npm workspaces.

Reason: npm keeps the workspace setup simple and matches the current lockfile strategy.

Consequence: pnpm-only files and dependency formats should not be used.

## ADR-006: Static Web and webCompat Are Temporary

Decision: `apps/api/public` and `webCompat` routes remain until Next.js replacements are tested.

Reason: They preserve current production behavior during migration.

Consequence: They must not be removed before parity, routing, and rollback are verified.

## ADR-007: Shared Packages Stay Framework and Runtime Clean

Decision: Shared packages should avoid backend runtime dependencies and app-specific UI.

Reason: Clean shared packages are easier to use across web, mobile, and backend-safe contract code.

Consequence: Prisma, Express, secrets, and app-specific screens stay out of shared packages.

## ADR-008: Foundation-First Implementation

Decision: Avenzo prioritizes a clean, maintainable foundation before rushing product features.

Reason: Auth, payments, orders, mobile, and restaurant operations need durable boundaries.

Consequence: Foundational cleanup should avoid business behavior changes and product shortcuts.

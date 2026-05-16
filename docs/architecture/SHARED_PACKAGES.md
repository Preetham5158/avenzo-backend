# Shared Packages

Shared packages exist to reduce duplication without blurring ownership. They should remain small, stable, and easy to understand.

## packages/shared

Use for:

- Types.
- DTOs.
- Enums.
- Constants.
- Validation schemas.
- Shared formatting utilities.

This package should not depend on backend runtime libraries or UI frameworks.

## packages/api-client

Use for:

- API request wrappers.
- Typed client methods.
- Shared web/mobile API access.

This package should eventually align with OpenAPI and may depend on `packages/shared`.

## packages/ui

Use for:

- Design tokens.
- Shared small UI primitives when needed.

Avoid moving app-specific screens, flows, or large composed UI here.

## packages/config

Use for:

- Shared TypeScript config.
- Shared lint or build config if needed later.

## Anti-Patterns

- Do not put Prisma in shared packages.
- Do not put Express in shared packages.
- Do not put app-specific React screens in `packages/ui`.
- Do not put secrets in packages.
- Do not create package abstractions before reuse is real.

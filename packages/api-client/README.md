# @avenzo/api-client

Shared API client package for Avenzo web and mobile apps.

This package should contain request wrappers and typed client methods that call `apps/api`. It may depend on `@avenzo/shared` for stable DTOs and response types.

It must not import Prisma, read database credentials, contain UI logic, or duplicate backend business rules. Over time, its methods should align with the OpenAPI contract owned by `apps/api`.

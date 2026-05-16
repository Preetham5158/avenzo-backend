# @avenzo/shared

Shared contracts and small utilities that are safe for every Avenzo app to use.

Use this package for:

- DTOs and API-facing TypeScript types.
- Shared enums and constants.
- Validation schemas once they are stable enough to reuse.
- Formatting helpers that do not depend on a runtime framework.

Do not put Prisma, Express, database access, backend secrets, React components, React Native components, or app-specific screen logic here.

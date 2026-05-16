# API Contract Strategy

`apps/api` is the source of truth for Avenzo API behavior. Client apps should treat the API contract as the boundary between product surfaces and backend internals.

## Contract Rules

- OpenAPI should describe public API contracts.
- `packages/api-client` should align with OpenAPI over time.
- API response shapes should be stable.
- Breaking changes should be intentional and documented.
- Stable API behavior should use `/api/v1`.
- Shared DTOs and types should move into `packages/shared` once stable.
- Important routes should gain contract tests over time.

## Ownership

- `apps/api` owns the route behavior and OpenAPI/spec files.
- `packages/api-client` owns typed request wrappers for web and mobile clients.
- Client apps consume the API client or direct API calls during transition, but never bypass `apps/api`.

## Next Steps

- Expand OpenAPI coverage.
- Align api-client methods with OpenAPI.
- Add tests for auth, restaurants, menus, orders, payments, webhooks, health, and ready endpoints.
- Document intentional breaking changes before clients adopt them.

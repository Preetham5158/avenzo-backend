# API Contract Status

Status after Phase 5 — v1 API Gap Closure for Mobile Readiness.

## Source of Truth

- Runtime implementation: `apps/api/src/routes` and `apps/api/src/modules`.
- OpenAPI contract: `apps/api/openapi/avenzo.v1.yaml`.
- Route inventory: `docs/architecture/API_ROUTE_INVENTORY.md`.
- Shared API client: `packages/api-client`.

## OpenAPI Coverage

The OpenAPI file now covers:

- `/health`
- `/ready`
- `/webhooks/razorpay`
- All currently registered `/api/v1` auth routes.
- All currently registered `/api/v1/public` routes.
- All currently registered customer order routes.
- All currently registered restaurant order routes.
- All currently registered payment routes.
- Restaurant menu availability and subscription routes.
- Customer and restaurant device-token routes.

## Phase 5 Additions

- `PATCH /api/v1/customer/profile` — v1 customer profile update with Bearer token. Replaces the webCompat `PATCH /customer/profile` for mobile and future web clients.
- `User` interface promoted to `packages/api-client` export. All auth methods now return typed `User` objects.
- See ADR-009 in `docs/architecture/DECISION_RECORDS.md` for the token refresh decision.

## Previously Missing Routes Added to OpenAPI

- `POST /api/v1/customer/auth/signup`
- `GET /api/v1/customer/auth/me`
- `GET /api/v1/restaurant/me`
- `GET /api/v1/me`
- `GET /api/v1/public/payment-methods`
- `GET /api/v1/public/orders/lookup`
- `GET /api/v1/public/orders/find`
- `GET /api/v1/customer/orders/:trackingToken`
- `GET /api/v1/customer/orders/:trackingToken/payment-status`
- `POST /api/v1/customer/orders/:trackingToken/cancel`
- `POST /api/v1/customer/orders/:trackingToken/rating`
- `GET /api/v1/restaurant/orders/:id`
- `PATCH /api/v1/restaurant/orders/:id/status`
- `POST /api/v1/customer/payments/upi/claim`
- `POST /api/v1/restaurant/payments/manual-confirm`
- `PATCH /api/v1/restaurant/menu/items/:id/availability`
- `GET /api/v1/restaurant/subscription`
- `POST /api/v1/customer/device-token`
- `POST /api/v1/restaurant/device-token`
- `GET /ready`
- `POST /webhooks/razorpay`

## api-client Alignment

`packages/api-client` now has methods for the current documented `/api/v1` client-facing routes:

- Auth: customer signup/login/me, **customer profile update**, restaurant login/me, generic me.
- Public: restaurant, menu, payment methods, order lookup, order find.
- Customer orders: create, list, get, payment status, cancel, rate.
- Restaurant orders: list, get, status update.
- Payments: Razorpay create, UPI claim, manual confirm.
- Restaurant: menu availability and subscription.
- Device tokens: customer and restaurant registration.

## Known Contract Notes

- `/webhooks/razorpay` is intentionally outside `/api/v1` because Razorpay calls it directly and raw-body verification is required.
- `webCompat` routes are intentionally not modeled as future client contracts. They support `apps/api/public` until web migration parity is complete.
- Some OpenAPI response schemas remain broad envelopes because serializers contain richer shapes than are currently promoted to shared DTOs.
- `packages/shared` should receive stable DTOs only after route shapes settle further.

## Remaining Gaps

- No generated client is wired from OpenAPI yet.
- OpenAPI schemas use broad object envelopes for complex order/menu/restaurant payloads.
- Contract tests verify route coverage and envelope/security behavior, but not every field of every success response.
- `webCompat` contracts remain documented as compatibility behavior, not as long-term API contracts.

## Suggested Next Steps

- Promote stable DTOs into `packages/shared` after mobile and web migration usage settles.
- Replace broad OpenAPI envelopes with typed schemas for order, menu, restaurant, and payment payloads as those contracts stabilize.
- Consider generating `packages/api-client` from OpenAPI once the schema is precise enough to avoid hand-written drift.
- Add focused success-response contract tests for high-value flows without duplicating lower-level service tests.

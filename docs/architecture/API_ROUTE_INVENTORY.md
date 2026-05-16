# API Route Inventory

This inventory documents the existing `apps/api` route contracts. It does not introduce future routes and does not document `webCompat` as a long-term API surface.

Response envelopes for `/api/v1`:

- Success: `{ "success": true, "data": ... }`
- List success: `{ "success": true, "data": [...], "pagination": ... }`
- Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`

## System

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| GET | `/health` | Public | None | `{ status: "ok", uptime: number }` | Not expected |
| GET | `/ready` | Public | None | `{ status: "ready", db: "ok" }` | `503 { status: "not ready", db: "error" }` |

## Webhook

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| POST | `/webhooks/razorpay` | Webhook-only | `x-razorpay-signature` header and Razorpay payload | `{ ok: true }` | `400 { error }`, `500 { ok: false }` |

## Auth

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/customer/auth/signup` | Public | Body: `email`, `password`, optional `name`, `phone` | `data.accessToken`, `data.expiresIn`, `data.user` | `VALIDATION_ERROR`, `CONFLICT`, `SERVER_ERROR` |
| POST | `/api/v1/customer/auth/login` | Public | Body: `email`, `password` | `data.accessToken`, `data.expiresIn`, `data.user` | `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `SERVER_ERROR` |
| GET | `/api/v1/customer/auth/me` | Customer-authenticated | Bearer token | `data.user` | `UNAUTHORIZED`, `NOT_FOUND`, `SERVER_ERROR` |
| POST | `/api/v1/restaurant/auth/login` | Public | Body: `email`, `password` | `data.accessToken`, `data.expiresIn`, `data.user`, `data.restaurant` | `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `SERVER_ERROR` |
| GET | `/api/v1/restaurant/me` | Restaurant-authenticated | Bearer token | `data.user`, `data.restaurant` | `UNAUTHORIZED`, `FORBIDDEN`, `SERVER_ERROR` |
| GET | `/api/v1/me` | Authenticated | Bearer token | `data.id`, `data.email`, `data.name`, `data.phone`, `data.role` | `UNAUTHORIZED`, `NOT_FOUND`, `SERVER_ERROR` |

## Public Restaurant, Menu, and Lookup

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/public/restaurants/:slug` | Public | Path: `slug` | Public restaurant fields plus `avgRating`, `ratingCount` | `NOT_FOUND`, `SERVER_ERROR` |
| GET | `/api/v1/public/restaurants/:slug/menu` | Public | Path: `slug`; query: optional `foodType` | `data.restaurant`, `data.categories`, `data.items`, `data.paymentMethods` | `NOT_FOUND`, `SERVICE_UNAVAILABLE`, `SERVER_ERROR` |
| GET | `/api/v1/public/payment-methods` | Public | Query: `slug` or `restaurantId` | Array of enabled payment methods | `BAD_REQUEST`, `NOT_FOUND`, `SERVER_ERROR` |
| GET | `/api/v1/public/orders/lookup` | Public | Query: `restaurantId` or `restaurantSlug`, plus `phone` | `data.orders[]` with tracking summary | `VALIDATION_ERROR`, `NOT_FOUND`, `SERVER_ERROR` |
| GET | `/api/v1/public/orders/find` | Public | Query: `phone`, `code` | `data.trackingToken` | `VALIDATION_ERROR`, `NOT_FOUND`, `SERVER_ERROR` |

## Customer Orders

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/customer/orders` | Public or customer-authenticated | Body: `items`, `sessionId`, `phone`, `restaurantSlug` or `restaurantId`, optional `paymentMethodId`, `tableNumber`, `idempotencyKey`, `guest` | `data.trackingToken`, `data.orderNumber`, `data.pickupCode`, `data.paymentStatus`, `data.paymentMethod`, `data.trackingUrl` | `VALIDATION_ERROR`, `NOT_FOUND`, `ITEM_UNAVAILABLE`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `SERVER_ERROR` |
| GET | `/api/v1/customer/orders` | Customer-authenticated | Query: optional `page`, `limit` | List envelope of customer order summaries | `UNAUTHORIZED`, `FORBIDDEN`, `SERVER_ERROR` |
| GET | `/api/v1/customer/orders/:trackingToken` | Public or authenticated | Path: `trackingToken` | Public order response | `NOT_FOUND`, `SERVER_ERROR` |
| GET | `/api/v1/customer/orders/:trackingToken/payment-status` | Public | Path: `trackingToken` | `data.paymentStatus`, `data.orderStatus` | `NOT_FOUND`, `SERVER_ERROR` |
| POST | `/api/v1/customer/orders/:trackingToken/cancel` | Public or customer-authenticated | Path: `trackingToken` | `data.cancelled` | `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SERVER_ERROR` |
| POST | `/api/v1/customer/orders/:trackingToken/rating` | Public or authenticated | Path: `trackingToken`; body: `rating`, optional `comment` | `data.rated`, `data.message` | `VALIDATION_ERROR`, `BAD_REQUEST`, `SERVER_ERROR` |

## Restaurant Orders

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/restaurant/orders` | Restaurant-authenticated | Query: optional `restaurantId`, `status`, `kitchen`, `page`, `limit` | List envelope of restaurant-visible orders | `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`, `VALIDATION_ERROR`, `SERVER_ERROR` |
| GET | `/api/v1/restaurant/orders/:id` | Restaurant-authenticated | Path: internal order `id` | Order response with internal id included | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SERVER_ERROR` |
| PATCH | `/api/v1/restaurant/orders/:id/status` | Restaurant-authenticated | Path: `id`; body: `status` | `data.id`, `data.status`, `data.orderNumber` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `PAYMENT_REQUIRED`, `SERVER_ERROR` |

## Payments

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/customer/payments/razorpay/create` | Public or customer-authenticated | Body: `trackingToken` | `data.razorpayOrderId`, `data.amount`, `data.currency`, `data.keyId`, or `data.alreadyPaid` | `VALIDATION_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `SERVICE_UNAVAILABLE`, `SERVER_ERROR` |
| POST | `/api/v1/customer/payments/upi/claim` | Public or customer-authenticated | Body: `trackingToken`, optional `paymentReference` | `data.claimed` or `data.alreadyPaid` | `VALIDATION_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `SERVER_ERROR` |
| POST | `/api/v1/restaurant/payments/manual-confirm` | Restaurant-authenticated | Body: `orderId` | `data.confirmed` or `data.alreadyPaid` | `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SERVER_ERROR` |

## Restaurant Management and Menu

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| PATCH | `/api/v1/restaurant/menu/items/:id/availability` | Restaurant-authenticated | Path: menu item `id`; body: optional `isAvailable` | `data.id`, `data.name`, `data.isAvailable` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SERVER_ERROR` |
| GET | `/api/v1/restaurant/subscription` | Restaurant-authenticated | Query: optional `restaurantId` | `data.subscriptionStatus`, `data.subscriptionEndsAt`, `data.isActive`, `data.serviceAvailable` | `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`, `SERVER_ERROR` |

## Device Tokens

| Method | Path | Access | Request | Success shape | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/customer/device-token` | Customer-authenticated | Body: `token`, `platform`, optional `appType` | `data.registered` | `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `SERVER_ERROR` |
| POST | `/api/v1/restaurant/device-token` | Restaurant-authenticated | Body: `token`, `platform`, optional `appType` | `data.registered` | `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `SERVER_ERROR` |

## Admin/Internal

There are no `/api/v1` admin-only routes today. Admin/static dashboard behavior still lives in the temporary `webCompat` compatibility layer and should remain untouched until migration parity is tested.

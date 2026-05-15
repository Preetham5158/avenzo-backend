# Avenzo Mobile API Plan

## Overview

The same Express backend serves the web frontend, the Avenzo Customer App, and the Avenzo Restaurant/Admin App. Mobile apps communicate exclusively through `/api/v1/**` routes that return a consistent JSON envelope.

### Response envelope

```json
// Success
{ "success": true, "data": { ... } }

// List with pagination
{ "success": true, "data": { "items": [...], "pagination": { "page": 1, "limit": 20, "total": 50 } } }

// Error
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

All v1 responses include `X-API-Version: v1` and `X-Request-ID` headers.

---

## Customer App (Expo React Native)

### Auth token storage

- Store `accessToken` in `expo-secure-store` (Keychain/Keystore)
- Store `user` object in AsyncStorage for UI hydration
- `expiresIn` is seconds; calculate absolute expiry and refresh before it lapses
- On 401 response: clear token, redirect to login screen

### Authentication flow

| Screen | Method | Endpoint |
|--------|--------|----------|
| Login | POST | `/api/v1/customer/auth/login` |
| Register | POST | `/api/v1/customer/auth/register` |
| Profile | GET | `/api/v1/customer/auth/me` |
| Logout | DELETE | `/api/v1/customer/auth/session` |
| OTP request | POST | `/api/v1/customer/auth/otp/request` |
| OTP verify | POST | `/api/v1/customer/auth/otp/verify` |

Login response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "expiresIn": 604800,
    "user": { "id": "...", "email": "...", "name": "...", "phone": "..." }
  }
}
```

### Guest QR ordering flow

1. Customer scans QR code → opens deep link `/menu/{menuKey}`
2. App calls `GET /api/v1/public/restaurants/{slug}` to get restaurant info
3. App calls `GET /api/v1/public/restaurants/{slug}/menu` to load menu
4. Customer builds cart locally
5. App calls `POST /api/v1/customer/orders` with `phone` (required for guest), no auth token
6. Response includes `trackingToken` — store locally for tracking
7. App polls `GET /api/v1/customer/orders/{trackingToken}/status` for live updates

### Screen → API mapping (Customer App)

| Screen | API Call(s) |
|--------|-------------|
| Restaurant landing | `GET /api/v1/public/restaurants/{slug}` |
| Menu | `GET /api/v1/public/restaurants/{slug}/menu` |
| Cart (submit) | `POST /api/v1/customer/orders` |
| Order tracking | `GET /api/v1/customer/orders/{trackingToken}/status` |
| Payment status | `GET /api/v1/customer/orders/{trackingToken}/payment-status` |
| Razorpay pay | `POST /api/v1/customer/orders/{trackingToken}/pay` |
| My orders | `GET /api/v1/customer/orders` (requires auth) |
| Order detail | `GET /api/v1/customer/orders/{trackingToken}` |
| Rate order | `POST /api/v1/customer/orders/{trackingToken}/rating` |
| Payment methods | `GET /api/v1/customer/payment-methods` (requires auth) |
| Add payment method | `POST /api/v1/customer/payment-methods` (requires auth) |
| Profile | `GET /api/v1/customer/auth/me` (requires auth) |
| Update profile | `PATCH /api/v1/customer/profile` (requires auth) |

### Order creation payload

```json
POST /api/v1/customer/orders
{
  "restaurantId": "uuid",
  "items": [{ "menuId": "uuid", "quantity": 2, "notes": "extra spicy" }],
  "phone": "+919876543210",
  "sessionId": "device-fingerprint-or-uuid",
  "paymentMethod": "ONLINE",
  "tableNumber": "T4",
  "specialInstructions": "No onions"
}
```

Headers: `Authorization: Bearer {token}` when logged in (omit for guest).

---

## Restaurant/Admin App (Expo React Native)

### Auth token storage

Same as customer app. The login response also includes `restaurant` context so apps can cache it without a second call.

### Authentication flow

| Screen | Method | Endpoint |
|--------|--------|----------|
| Login | POST | `/api/v1/restaurant/auth/login` |
| Profile | GET | `/api/v1/restaurant/auth/me` |

Login response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "expiresIn": 604800,
    "user": { "id": "...", "email": "...", "name": "...", "role": "RESTAURANT_OWNER" },
    "restaurant": { "id": "...", "name": "...", "slug": "...", "isActive": true }
  }
}
```

### Screen → API mapping (Restaurant App)

| Screen | API Call(s) |
|--------|-------------|
| Dashboard | `GET /api/v1/restaurant/orders?status=PENDING` |
| Kitchen queue | `GET /api/v1/restaurant/orders?kitchen=true` |
| Order detail | `GET /api/v1/restaurant/orders/{id}` |
| Update order status | `PATCH /api/v1/restaurant/orders/{id}/status` |
| Confirm UPI payment | `PATCH /api/v1/restaurant/orders/{id}/confirm-payment` |
| Menu list | `GET /api/v1/restaurant/menu` |
| Add item | `POST /api/v1/restaurant/menu` |
| Edit item | `PATCH /api/v1/restaurant/menu/{id}` |
| Toggle item available | `PATCH /api/v1/restaurant/menu/{id}/toggle` |
| Delete item | `DELETE /api/v1/restaurant/menu/{id}` |
| Payment methods | `GET /api/v1/restaurant/payment-methods` |
| Add payment method | `POST /api/v1/restaurant/payment-methods` |
| Delete payment method | `DELETE /api/v1/restaurant/payment-methods/{id}` |
| Settings | `PATCH /api/v1/restaurant/settings` |

### Kitchen queue safety rule

The kitchen queue endpoint (`?kitchen=true`) automatically excludes `PAYMENT_PENDING` orders. Staff only see orders that are confirmed or payment-not-required. This is enforced server-side and cannot be bypassed.

### Order status transitions

```
PENDING → PREPARING → READY → DELIVERED
               ↑
         blocked if paymentStatus = PAYMENT_PENDING
```

`PATCH /api/v1/restaurant/orders/{id}/status` returns `402 PAYMENT_REQUIRED` if you try to move to `PREPARING` while payment is still pending.

---

## Device Token Model

The `DeviceToken` table is in the schema and migrations are applied. Push notification integration requires:

1. Expo Push Token (from `expo-notifications`) sent on login / app foreground
2. `POST /api/v1/customer/device-token` or `POST /api/v1/restaurant/device-token` with:
   ```json
   { "token": "ExponentPushToken[...]", "platform": "ios|android", "appType": "customer|restaurant" }
   ```
3. Backend upserts by token (deduplication built in)
4. Notification service reads device tokens and calls Expo Push API

The device token routes are scaffolded in `/api/v1`. Full push notification delivery requires implementing the Expo Push API call in `src/services/notification.service.js`.

---

## Error codes reference

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Valid token but wrong role |
| `NOT_FOUND` | 404 | Resource does not exist |
| `PAYMENT_REQUIRED` | 402 | Action blocked until payment confirmed |
| `RESTAURANT_UNAVAILABLE` | 423 | Restaurant is inactive or subscription lapsed |
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `IDEMPOTENCY_CONFLICT` | 409 | Duplicate request with same idempotency key |

---

## Versioning strategy

- Current version: `v1`
- Breaking changes get a new prefix: `/api/v2/**`
- Old versions remain live for at least one app release cycle (typically 30 days)
- `X-API-Version: v1` header on every response lets clients detect mismatches

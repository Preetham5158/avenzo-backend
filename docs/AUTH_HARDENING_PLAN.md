# Auth Hardening Plan

## Current State

All authenticated users (customer and restaurant/admin) require email OTP after password verification.

- Customer login: `POST /auth/customer/login` → OTP challenge → `POST /auth/otp/verify` → token.
- Restaurant/admin login: `POST /auth/restaurant/login` → OTP challenge → `POST /auth/otp/verify` → token.
- `USER` accounts are blocked from restaurant/admin APIs and the restaurant login path.
- OTP is stored as a bcrypt hash. Plaintext OTP is never logged in production or returned in API responses.
- OTP challenges expire based on `OTP_TTL_MINUTES` (default 10). Max attempts enforced by `OTP_MAX_ATTEMPTS` (default 5).
- Challenges are consumed (marked `consumedAt`) after successful verification to prevent reuse.
- Auth tokens are stored in `sessionStorage` — tab-isolated, not persisted across sessions.
- Guest ordering never requires login or OTP.

## 2FA Flags

| Variable | Default | Notes |
|---|---|---|
| `AUTH_REQUIRE_RESTAURANT_2FA` | `true` | Always on in production |
| `AUTH_REQUIRE_CUSTOMER_2FA` | `true` | Always on in production. Set `false` locally with `OTP_MODE=log` for dev speed. |

## OTP Provider

Email OTP delivered via Resend (`OTP_MODE=email`).
Development fallback: `OTP_MODE=log` prints OTP to server console. Blocked in `NODE_ENV=production`.

## Role Boundaries

- `USER` → customer login path only; blocked from all restaurant/admin APIs.
- `ADMIN` → restaurant login path; full admin access.
- `RESTAURANT_OWNER` → restaurant login path; own restaurant workspace only.
- `EMPLOYEE` → restaurant login path; assigned restaurant operational access only.

## Additional Work (Future)

- Shorter access token lifetime with refresh token rotation.
- HttpOnly Secure cookie storage once the frontend supports CSRF protection.
- Device/session audit view for account holders.
- Suspicious login detection (new device, unusual geography).
- Centralised validation and error middleware.
- Split remaining route handlers from `src/index.js` into route/controller/service modules.
- Retire `/auth/login` compatibility endpoint after all clients have migrated to role-specific paths.

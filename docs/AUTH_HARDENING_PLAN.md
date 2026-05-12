# Auth Hardening Plan

Current auth uses JWT bearer tokens stored by the frontend. This is simple for the current static app, but localStorage has XSS exposure risk.

## Target

- Move auth to `HttpOnly`, `Secure`, `SameSite` cookies.
- Add CSRF protection for state-changing requests.
- Add session revocation and token rotation.
- Keep customer and restaurant login paths visibly separate.
- Reduce inline JavaScript and tighten CSP by removing `unsafe-inline`.

## Current Behavior

- Customer auth uses `/auth/customer/login` and `/auth/customer/signup`.
- Restaurant/admin auth uses `/auth/restaurant/login`.
- Restaurant login requires OTP when `AUTH_REQUIRE_RESTAURANT_2FA=true`.
- OTP log mode is development-only and must be replaced with a configured email/SMS provider before production 2FA enforcement.
- `/auth/login` remains only for compatibility and should be retired after clients move.

## Additional Work

- Shorter access token lifetime.
- Refresh token rotation.
- Device/session audit view.
- Suspicious login detection.
- Centralized validation and error middleware.

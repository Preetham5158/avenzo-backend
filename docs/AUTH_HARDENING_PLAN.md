# Auth Hardening Plan

Current auth uses JWT bearer tokens stored by the frontend. This is simple for the current static app, but localStorage has XSS exposure risk.

## Target

- Move auth to `HttpOnly`, `Secure`, `SameSite` cookies.
- Add CSRF protection for state-changing requests.
- Add session revocation and token rotation.
- Keep customer and restaurant login paths visibly separate.
- Reduce inline JavaScript and tighten CSP by removing `unsafe-inline`.

## Additional Work

- Shorter access token lifetime.
- Refresh token rotation.
- Device/session audit view.
- Suspicious login detection.
- Centralized validation and error middleware.

# Static Web Migration

`apps/api/public` currently serves existing static web pages. The `webCompat` routes exist to preserve current behavior while the Next.js web apps are built and tested.

This compatibility layer is temporary, but it is still required right now. Do not remove `apps/api/public`, static page routes, or `webCompat` routes until replacements are implemented, deployed, and verified.

## Direction

- `apps/customer-web` should eventually replace customer static pages.
- `apps/restaurant-web` should eventually replace admin and restaurant dashboard static pages.
- `apps/api/public` and `webCompat` should be removed only after full migration and testing.

## Migration Order

1. customer-web landing page
2. customer-web restaurant menu page `/r/[slug]`
3. customer-web cart/order flow
4. customer-web order tracking
5. customer login/signup/order history
6. restaurant-web login
7. restaurant dashboard
8. restaurant order management
9. restaurant menu management
10. restaurant settings/subscription pages
11. verify parity
12. remove `apps/api/public` static dependency
13. remove `webCompat` routes

## Current Route Map

| Current static page | Target Next.js page |
|---|---|
| `apps/api/public/index.html` | `apps/customer-web/app/page.tsx` |
| `apps/api/public/menu.html` | `apps/customer-web/app/r/[slug]/page.tsx` |
| `apps/api/public/customer-login.html` | `apps/customer-web/app/login/page.tsx` |
| `apps/api/public/customer-signup.html` | `apps/customer-web/app/signup/page.tsx` |
| `apps/api/public/track.html` | `apps/customer-web/app/track/[token]/page.tsx` |
| `apps/api/public/customer.html` | `apps/customer-web/app/dashboard/page.tsx` |
| `apps/api/public/customer-orders.html` | `apps/customer-web/app/orders/page.tsx` |
| `apps/api/public/admin/*` | `apps/restaurant-web/app/*` |

## Removal Criteria

Do not remove the compatibility layer before replacement is tested. Removal should happen only after customer web and restaurant web parity is verified, production routing is stable, and rollback behavior is understood.

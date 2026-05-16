# Frontend Boundaries

Frontend and mobile apps are clients. They must call `apps/api` and must never import Prisma, read database credentials, or contain backend secrets.

## Client Apps

`apps/customer-web` owns the public customer web experience. It will eventually cover restaurant menu browsing, cart, checkout, order tracking, customer auth, and order history.

`apps/restaurant-web` owns the restaurant owner and staff dashboard. It will eventually cover orders, menus, settings, subscription, and payment administration. It should not be mixed with customer-facing UX.

`apps/customer-mobile` owns the native/mobile-first customer app shell. It will eventually cover QR/menu flows, order tracking, and order history.

`apps/restaurant-mobile` owns native/mobile-first restaurant operations. It will eventually cover order queues, status updates, and notifications.

## Rules

- No direct database access.
- No Prisma imports.
- No backend secrets.
- Use `packages/api-client` for API calls as the client layer matures.
- Use `packages/shared` for stable shared DTOs and types.
- Keep app-specific UI inside the app unless it is truly shared.
- Do not duplicate backend business rules in client apps.

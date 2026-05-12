# Avenzo Project Rules

Avenzo is a production-bound restaurant/customer dine-in ordering platform.

## Branch rules
- Work from `develop`.
- Push only to `develop`.
- Never push to `main` unless explicitly asked.
- Do not use `prisma db push`.
- Use Prisma migrations only.
- Do not commit `.env`, `.git`, `node_modules`, zip files, screenshots, temp logs, or secrets.

## Product shells
The app has three shells:
1. Public shell
2. Customer shell
3. Restaurant/Admin shell

Keep these separated clearly.

## Role access
- USER is customer only.
- ADMIN uses Restaurant Partner sign in and can access admin pages.
- RESTAURANT_OWNER accesses only assigned restaurant workspace.
- EMPLOYEE accesses only permitted assigned restaurant operations.
- Customers must never access admin/restaurant pages.
- Backend must enforce access; frontend hiding is not enough.

## Customer flow
- Guest QR/public restaurant orders must behave as guest-first ordering.
- Guest QR order requires phone.
- Logged-in customer order uses saved phone when available.
- Logged-in orders attach customerId.
- Guest orders must not appear in customer account automatically.
- Public tracking uses trackingToken only.
- Public menu uses menuKey only.

## UI standards
- Customer pages must not use technical language.
- Restaurant/admin pages must be operational and business-friendly.
- Mobile must be tested at 360px, 430px, 768px, and desktop.
- No overlapping sticky headers, tabs, or bottom navigation.
- Keep typography, spacing, cards, buttons, and badges consistent.
- Do not dump everything into one dashboard. Use proper pages and navigation.

## Security
- Do not expose internal IDs in public/customer APIs.
- Do not expose ownerId, staffRestaurantId, password, raw metadata, internal order ID, internal menu/category IDs.
- Reject invalid tokens safely.
- No stack traces to users.
- Rate-limit sensitive endpoints.
- Protected pages must not show private content before access checks complete.

## Code structure
- Do not keep adding large amounts of code into one file if it can be cleanly separated.
- Prefer helpers, serializers, services, middleware, and page-specific frontend files when practical.
- Remove dead/commented-out code.
- Add short useful comments only for business rules, security decisions, and non-obvious logic.

## Testing before finishing
Run:
- npm install
- npx prisma generate
- npx prisma validate
- npx prisma migrate status
- node --check src/server.js
- node --check src/app.js
- node --check src/index.js
- node --check scripts/smoke-test.js
- npm start boot check
- node scripts/smoke-test.js while the server is running

Manual checks should include:
- Public pages
- Customer signup/login
- Customer pages
- Guest QR order
- Logged-in customer order
- Tracking
- Restaurant Partner login
- Admin dashboard
- Owner/employee access restrictions
- Mobile at 360px and 430px
- Tablet at 768px
- Desktop at 1366px

Final response must include:
- Issues found
- Fixes made
- Files changed
- Commands run
- Manual tests
- Known risks
- Confirmation pushed to develop only

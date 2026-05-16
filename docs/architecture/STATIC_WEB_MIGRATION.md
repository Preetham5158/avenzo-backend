# Static Web Migration Plan

The current `apps/api/public/` contains the HTML/CSS/JS static frontend.
This is a temporary compatibility layer kept until the Next.js apps are ready.

## Migration Map

| Current static page | Target Next.js page |
|---|---|
| public/index.html | apps/customer-web/app/page.tsx |
| public/menu.html | apps/customer-web/app/r/[slug]/page.tsx |
| public/customer-login.html | apps/customer-web/app/login/page.tsx |
| public/customer-signup.html | apps/customer-web/app/signup/page.tsx |
| public/track.html | apps/customer-web/app/track/[token]/page.tsx |
| public/customer.html | apps/customer-web/app/dashboard/page.tsx |
| public/customer-orders.html | apps/customer-web/app/orders/page.tsx |
| public/admin/* | apps/restaurant-web/app/* |

## When to Delete public/
Delete public/ only after:
1. customer-web is deployed and tested in production
2. restaurant-web is deployed and tested in production
3. All routes/features have equivalent Next.js implementations
4. DNS/redirects are in place

## API Contract
All static pages must use /api/v1 exclusively.
The webCompat routes (src/routes/web-compat.routes.js) exist only to support these pages during migration.

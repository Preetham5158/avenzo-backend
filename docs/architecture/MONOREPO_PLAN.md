> **Archived**: This was a planning document. The monorepo has been implemented. See BACKEND_ARCHITECTURE.md for current structure.

# Future Monorepo Plan

## Current state

The project is a single Node.js backend repository. Web frontends are served as static files from the same server. Mobile apps (Expo React Native) will be separate repositories initially.

This document describes the recommended path to a monorepo when the project grows beyond one backend team member and two app teams.

---

## When to migrate

Migrate when **two or more** of these are true:

- Web frontend has its own deployment pipeline (Vercel, Netlify, etc.)
- Mobile apps are developed by a separate team or contractor
- Shared TypeScript types between backend and mobile cause out-of-sync bugs
- `docs/` folder is the only way to communicate API contracts

Do not migrate just because it sounds better. The current single-repo structure has zero overhead and is appropriate for the current team size.

---

## Recommended structure (Turborepo)

```
avenzo/
├── apps/
│   ├── api/                   # Current backend (Node.js/Express)
│   ├── customer-web/          # React/Next.js customer web frontend
│   ├── restaurant-web/        # React/Next.js restaurant admin web
│   ├── customer-mobile/       # Expo React Native customer app
│   └── restaurant-mobile/     # Expo React Native restaurant/admin app
├── packages/
│   ├── shared-types/          # Zod schemas + TypeScript types (request/response)
│   ├── ui/                    # Shared React Native + React component library
│   └── eslint-config/         # Shared lint rules
├── turbo.json
├── package.json               # Workspace root
└── pnpm-workspace.yaml
```

---

## packages/shared-types

The highest-value shared package. Contains:

- Zod schemas for all API request bodies (validated in backend and mobile)
- TypeScript types for all API response shapes
- Error code enum matching backend `v1err` codes

Example:
```typescript
// packages/shared-types/src/orders.ts
export const CreateOrderSchema = z.object({
  restaurantId: z.string().uuid(),
  items: z.array(z.object({ menuId: z.string().uuid(), quantity: z.number().int().min(1) })),
  phone: z.string().optional(),
  sessionId: z.string().min(8),
  paymentMethod: z.enum(["ONLINE", "UPI_QR", "CASH"]).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
```

The backend imports from `@avenzo/shared-types` instead of defining its own inline validation. The mobile apps import the same types for form validation and TypeScript safety.

---

## apps/api migration steps

1. Move `avenzo-backend/` contents into `apps/api/`
2. Update `DATABASE_URL` and other env vars to be workspace-root `.env` or per-app `.env`
3. Add `"name": "@avenzo/api"` to `apps/api/package.json`
4. Move Prisma schema to `apps/api/prisma/` (it stays there — Prisma is backend-only)
5. Import shared types: `const { CreateOrderSchema } = require("@avenzo/shared-types")`

---

## apps/customer-mobile setup

```
apps/customer-mobile/
├── app/                   # Expo Router file-based routes
│   ├── (tabs)/
│   │   ├── index.tsx      # Home / restaurant scan
│   │   ├── orders.tsx     # My orders (auth required)
│   │   └── profile.tsx
│   ├── menu/[slug].tsx    # Public menu from QR scan
│   ├── track/[token].tsx  # Order tracking
│   └── auth/
│       ├── login.tsx
│       └── register.tsx
├── components/
├── hooks/
│   ├── useAuth.ts         # Token storage + refresh
│   └── useApi.ts          # Typed fetch wrapper
├── lib/
│   └── api.ts             # Base URL + headers
└── app.json
```

---

## apps/restaurant-mobile setup

```
apps/restaurant-mobile/
├── app/
│   ├── (tabs)/
│   │   ├── orders.tsx     # Live order queue
│   │   ├── kitchen.tsx    # Kitchen-filtered queue
│   │   ├── menu.tsx       # Menu management
│   │   └── settings.tsx
│   └── auth/
│       └── login.tsx
├── components/
│   ├── OrderCard.tsx
│   └── StatusBadge.tsx
└── app.json
```

---

## Shared UI package (optional, later)

Only extract to `packages/ui` when both mobile apps share 5+ components. Until then, keep components in each app. Premature extraction creates unnecessary build complexity.

---

## CI/CD with Turborepo

```json
// turbo.json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

Turborepo caches build artifacts so only changed packages rebuild. GitHub Actions matrix strategy runs each app's tests in parallel.

---

## Migration priority

1. **Now (no migration needed)**: Backend + docs + tests in current repo
2. **When mobile development starts**: Create `apps/customer-mobile` and `apps/restaurant-mobile` as separate repos; share API contract via `docs/MOBILE_API_PLAN.md`
3. **When shared types become a pain point**: Extract `packages/shared-types` and link via workspace
4. **When all three are in active development simultaneously**: Full monorepo with Turborepo

---

## What NOT to do

- Do not share the Prisma client across apps — Prisma is backend-only
- Do not put `.env` secrets in the monorepo root — keep per-app `.env` files
- Do not use Yarn workspaces if the team is already on npm — pnpm workspaces have better disk efficiency for this structure
- Do not migrate before the mobile apps are past proof-of-concept — the overhead is not worth it for a v1 MVP

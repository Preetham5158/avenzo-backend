# Environment Variables Guide

## Principles
- API secrets are server-only (never in NEXT_PUBLIC_* or EXPO_PUBLIC_*)
- NEXT_PUBLIC_* is bundled into the Next.js client — visible to users
- EXPO_PUBLIC_* is bundled into the Expo app — visible to users
- Never put JWT_SECRET, DATABASE_URL, or Razorpay secrets in client env

## Per-App Variables

### apps/api
See apps/api/.env.example

Required in production:
- DATABASE_URL (Supabase pgBouncer URL)
- DIRECT_URL (Supabase direct URL for migrations)
- REDIS_URL (Redis/Upstash)
- JWT_SECRET (min 32 chars)
- RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET

### apps/customer-web
- NEXT_PUBLIC_API_URL — API base URL
- NEXT_PUBLIC_GOOGLE_CLIENT_ID — Google Sign-In
- NEXT_PUBLIC_RAZORPAY_KEY_ID — Razorpay checkout key

### apps/restaurant-web
- NEXT_PUBLIC_API_URL

### apps/customer-mobile + apps/restaurant-mobile
- EXPO_PUBLIC_API_URL
- EXPO_PUBLIC_GOOGLE_CLIENT_ID
- EXPO_PUBLIC_RAZORPAY_KEY_ID

## Render Deployment
Set env vars in Render dashboard.
Do not commit .env files.
Build command: npm run prisma:migrate:deploy && npm run prisma:generate
Start command: node src/server.js (from apps/api/)

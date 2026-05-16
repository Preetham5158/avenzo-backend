# OpenAPI Plan

## API Contract
REST + OpenAPI 3.1 is the official stable API contract for Avenzo.
/api/v1 is the stable versioned API used by all clients (web, mobile, external).

## Status
Skeleton YAML at apps/api/openapi/avenzo.v1.yaml.
Full documentation is in progress.

## Why REST over tRPC
- External integrations (Razorpay, Resend, future delivery partners) require REST
- OpenAPI enables client generation for mobile, web, and partners
- REST webhooks (Razorpay) are already in production

## Client Generation Plan
Once OpenAPI spec is stable:
1. Generate TypeScript client into packages/api-client/
2. Remove hand-written client methods
3. Keep AvenzoApiClient wrapper for auth/token management

## Current Documented Paths
See apps/api/openapi/avenzo.v1.yaml

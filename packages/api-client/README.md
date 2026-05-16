# @avenzo/api-client

Shared API client for Avenzo web and mobile apps. Wraps `apps/api` `/api/v1` endpoints with typed methods.

## Rules

- Must not import Prisma, read database credentials, or contain UI logic.
- Must not duplicate backend business rules.
- Methods align with the OpenAPI contract at `apps/api/openapi/avenzo.v1.yaml`.

## Usage — Web (Next.js)

```ts
import { AvenzoApiClient } from "@avenzo/api-client";

const api = new AvenzoApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
  // Default: reads access token from sessionStorage key "avenzo_access_token"
});

const { user } = await api.auth.customerMe();
```

## Usage — React Native (Expo)

`sessionStorage` does not exist in React Native. You must supply a `getToken` function backed by AsyncStorage (or SecureStore):

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AvenzoApiClient } from "@avenzo/api-client";

const TOKEN_KEY = "avenzo_access_token";

const api = new AvenzoApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  getToken: () => {
    // AsyncStorage is async — cache the token in a module-level variable
    // after login, then return it synchronously here.
    return tokenCache; // see note below
  },
});
```

**Token caching pattern for React Native:**

```ts
let tokenCache: string | null = null;

export async function setToken(token: string | null) {
  tokenCache = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

export async function restoreToken() {
  tokenCache = await AsyncStorage.getItem(TOKEN_KEY);
  return tokenCache;
}
```

Call `restoreToken()` on app startup before the first authenticated API call.

## Token expiry and re-login (mobile)

Tokens expire after 7 days (`expiresIn: 604800` seconds, returned by login/signup).

Mobile apps must:
1. Intercept `401` responses and clear the stored token.
2. Redirect the user to the login screen.
3. Optionally, compute the expiry time from `expiresIn` and show a prompt before it elapses.

See `docs/architecture/DECISION_RECORDS.md` ADR-009 for the full token strategy decision.

## Available methods

### `api.auth`

| Method | Endpoint | Auth |
|---|---|---|
| `customerSignup(body)` | `POST /api/v1/customer/auth/signup` | None |
| `customerLogin(email, password)` | `POST /api/v1/customer/auth/login` | None |
| `customerMe()` | `GET /api/v1/customer/auth/me` | Bearer |
| `updateCustomerProfile(body)` | `PATCH /api/v1/customer/profile` | Bearer |
| `restaurantLogin(email, password)` | `POST /api/v1/restaurant/auth/login` | None |
| `restaurantMe()` | `GET /api/v1/restaurant/me` | Bearer |
| `me()` | `GET /api/v1/me` | Bearer |

### `api.orders`, `api.restaurantOrders`, `api.payments`, `api.restaurant`, `api.deviceTokens`

See `packages/api-client/src/client.ts` for the full method list and typed signatures.

## Types

```ts
import type { User } from "@avenzo/api-client";
// User: { id, email, name: string|null, phone: string|null, role }
```

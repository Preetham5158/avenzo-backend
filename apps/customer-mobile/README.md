# @avenzo/customer-mobile

Expo (React Native) app for Avenzo customers. Handles dine-in ordering via QR code.

## Status

Phase 6 — Auth shell complete. Screens: login, signup, profile.
Order/menu/payment screens are not yet implemented.

---

## Setup

### 1. Copy the env file

```bash
cp apps/customer-mobile/.env.example apps/customer-mobile/.env
```

### 2. Set the API URL

Edit `apps/customer-mobile/.env`:

```env
# Local dev (API running on your machine)
EXPO_PUBLIC_API_URL=http://localhost:5000

# Android emulator pointing to your machine's localhost
EXPO_PUBLIC_API_URL=http://10.0.2.2:5000

# Staging or production (Render)
EXPO_PUBLIC_API_URL=https://your-app.onrender.com
```

> `EXPO_PUBLIC_*` variables are inlined at build time by Metro. They are safe to use in
> client code but must never contain secrets.

### 3. Install dependencies

From the monorepo root:

```bash
npm install
```

### 4. Start the app

```bash
npm --prefix apps/customer-mobile run start
```

Or from the monorepo root via Turbo:

```bash
npm run dev
```

Use the Expo Go app (iOS/Android) to scan the QR code, or press `a` for Android emulator / `i` for iOS simulator.

---

## Auth flow

```
App opens
  └─ AuthProvider.useEffect: restoreToken() reads AsyncStorage
       ├─ No token → loading=false → index redirects → /login
       └─ Token found → GET /api/v1/me
            ├─ 200 OK → setUser(me) → index redirects → /(app)/profile
            └─ Error   → clear token → loading=false → /login
```

After login or signup:
- Token is saved to AsyncStorage and cached in memory.
- User state is set in AuthContext.
- App navigates to `/(app)/profile`.

Logout:
- Token is removed from AsyncStorage and cache.
- User state is set to null.
- `(app)/_layout.tsx` detects `user === null` and redirects to `/login`.

---

## Token storage

| Concern | Approach |
|---|---|
| Persistence | `@react-native-async-storage/async-storage` |
| Synchronous access | Module-level `tokenCache` in `src/lib/tokenStore.ts` |
| Startup | `restoreToken()` called once in `AuthProvider` before first render |
| After login/signup | `setToken(accessToken)` updates both cache and AsyncStorage |
| On logout | `setToken(null)` clears both |
| On 401 | `updateProfile` catches 401, clears token, resets user → back to login |
| Expiry | Tokens are valid for 7 days (`expiresIn: 604800`). No refresh token. Re-login required after expiry. |

> `getToken()` in `src/lib/apiClient.ts` is synchronous — it reads from the in-memory cache,
> not from AsyncStorage. The cache is warm after `restoreToken()` resolves on startup.

---

## File structure

```
apps/customer-mobile/
  app/
    _layout.tsx          Root layout — SafeAreaProvider, AuthProvider, root Stack
    index.tsx            Redirect gate — spinner while loading, then → login or profile
    (auth)/
      _layout.tsx        Auth group — redirects already-authed users to profile
      login.tsx          Email + password sign in
      signup.tsx         Email + password sign up (name/phone optional)
    (app)/
      _layout.tsx        App group — redirects unauthenticated users to login
      profile.tsx        View and edit name/phone; sign out
    cart.tsx             Placeholder (not yet implemented)
    orders/index.tsx     Placeholder (not yet implemented)
  src/
    context/
      AuthContext.tsx    User state, login/signup/logout/updateProfile, error
    lib/
      apiClient.ts       Singleton AvenzoApiClient wired to tokenStore.getToken
      tokenStore.ts      AsyncStorage-backed token cache
```

---

## API client

`src/lib/apiClient.ts` exports a singleton `apiClient` backed by `@avenzo/api-client`.

```ts
import { apiClient } from "@/lib/apiClient";

const res = await apiClient.auth.customerLogin(email, password);
// res: { accessToken, expiresIn, user }
```

The `getToken` function is supplied from `tokenStore.getToken` — no `sessionStorage` is used.
This is required for React Native compatibility (no browser storage APIs).

---

## Known limitations

- No refresh token. Sessions are 7-day JWTs. After expiry the user must sign in again.
- `app/cart.tsx` and `app/orders/index.tsx` are placeholder stubs with no auth guard. They are not linked from any navigation yet.
- No network error distinction (timeout vs server down both surface as "Request failed").
- Android physical device testing requires `EXPO_PUBLIC_API_URL` to point to your machine's LAN IP, not `localhost`.
- No offline support.

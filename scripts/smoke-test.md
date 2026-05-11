# Avenzo Smoke Test

Run against a local server or a staging URL. Set `BASE_URL` to the target, for example `http://localhost:5000`.

## Setup

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm start
```

## Checklist

1. Sign up a new account from `/signup.html`.
   - Confirm the created user has role `USER`.
   - Login should redirect to `/customer.html`.
   - The page should show the customer placeholder, not restaurant-owner pending access.

2. Login as an admin from `/login.html`.
   - `/auth/me` should return role `ADMIN`.
   - `/admin/dashboard.html` should show all restaurants.

3. Submit `/restaurant-interest.html`.
   - Required fields: restaurant name, contact name, phone, email.
   - Success message: `Thanks for your interest. The Avenzo team will get back to you soon.`
   - `GET /admin/restaurant-leads` should work for admin.
   - `GET /admin/restaurant-leads` should return `403` for non-admin.

4. Open an active public restaurant menu.
   - Public restaurant response should not include owner or staff data.
   - Public menu prices should be returned as rupees.

5. Create an order from a public menu.
   - Response should include `trackingToken`.
   - Response should not require an internal order ID.

6. Open `/order/:trackingToken`.
   - Response should not include internal `id`.
   - Tracking page should update status after admin status changes.

7. Set a restaurant subscription to `EXPIRED` or set `subscriptionEndsAt` in the past.
   - Public order creation should return `423`.
   - Owner/employee menu and orders pages should show the workspace paused message.
   - Admin should still be able to edit subscription fields.

8. Renew the restaurant.
   - Set subscription status to `ACTIVE`.
   - Set `subscriptionEndsAt` to a future date or use Renew 30 days.
   - Owner/employee access should resume.

9. Staff management.
   - Admin or restaurant owner can add an existing user by email.
   - Added user becomes `EMPLOYEE` and sees the assigned restaurant.
   - Employee cannot manage staff.
   - Removing employee clears restaurant access and returns role to `USER` when appropriate.

10. Admin order pagination.
    - Orders page loads page 1 with `limit=50`.
    - Status filter requests the backend with `status`.
    - Previous/Next changes pages.
    - Status update buttons still work.

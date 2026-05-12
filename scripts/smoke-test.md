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

1. Sign up a new account from `/customer-signup.html`.
   - Confirm the created user has role `USER`.
   - Customer Login at `/customer-login.html` should redirect to `/customer.html`.
   - Customer home should be focused and not contain the full restaurant/order/profile experience.
   - Customer nav should link to `/customer-restaurants.html`, `/customer-orders.html`, and `/customer-profile.html`.

2. Login as an admin from `/restaurant-login.html`.
   - `/auth/me` should return role `ADMIN`.
   - Restaurant login should require OTP when `AUTH_REQUIRE_RESTAURANT_2FA=true`.
   - OTP verification should redirect to `/admin/dashboard.html`.
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
   - Checkout should require a valid phone number.
   - Response should include `trackingToken`.
   - Response should not require an internal order ID.
   - Response should include notification wording, not a false SMS/email promise.
   - Notification intent should be logged in development/no-op mode.

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

11. Customer order history.
    - Place an order while logged in as a customer.
    - `/customer/orders` should list it.
    - The response should include `trackingToken` and should not expose internal order ID.
    - `/customer-restaurants` should not expose restaurant UUIDs.
    - Logged-in checkout should use saved profile phone without asking again.
    - Logged-in checkout without saved phone should ask once and save the phone.
    - Guest orders should not appear in `/customer/orders`.

12. Dirty-order checks.
    - Missing phone should fail.
    - Invalid phone should fail.
    - Missing/short session ID should fail.
    - Blocked phone/device records should reject order attempts.

13. Mobile menu.
    - Category navigation should render as horizontal sticky chips on mobile.
    - Menu list should be full width.
    - Cart bar should only enable ordering when items are in cart.

14. Legal pages.
    - `/privacy.html`, `/terms.html`, and `/refund-policy.html` should load.

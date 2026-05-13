# Notification Plan

## Current State

- OTP delivery: **Resend email** (`OTP_MODE=email`) — implemented and live.
- Order notifications: **Resend email** (`NOTIFICATION_MODE=email`) — implemented and live.
- Development fallback: `OTP_MODE=log` prints OTP to server console. Blocked in `NODE_ENV=production`.

## Provider — Resend

Domain `avenzo.app` is verified in the Resend dashboard.
Sender: `Avenzo <no-reply@avenzo.app>`.

Required environment variables:
```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
FROM_EMAIL=Avenzo <no-reply@avenzo.app>
SUPPORT_EMAIL=support@avenzo.app
OTP_MODE=email
NOTIFICATION_MODE=email
```

## OTP Emails

Triggered by:
- Customer login (`CUSTOMER_LOGIN` purpose)
- Restaurant/admin login (`RESTAURANT_LOGIN` purpose)
- Resend via `POST /auth/otp/resend`

Subject: `Your Avenzo verification code`
Content: code displayed prominently, TTL reminder, ignore-if-not-requested notice.

OTP is stored as a bcrypt hash. The plaintext OTP is never logged or returned in any API response.

## Order Confirmation Email

Triggered after `POST /order` succeeds for a logged-in customer with an email address.
Guest orders without email do not receive a confirmation — order creation is never blocked by email failure.

Includes: restaurant name, order number, pickup code, total, tracking link.

## Order Status Emails

Triggered on `PATCH /order/:id/status` for:
- `READY` — "Your order is ready for collection."
- `CANCELLED` — "Your order has been cancelled."
- `COMPLETED` — "Your order is complete."

Only sent when the order belongs to a logged-in customer with an email address.
Failures are logged in `NotificationLog` but never surface to the restaurant operator or customer as an error.

## Failure Handling

All delivery failures are logged in `NotificationLog` with `status: FAILED` and a sanitised error field.
OTP delivery failure throws a user-friendly error message; login is blocked until a code is delivered successfully.
Order notification failure is silent to the user — order creation and status updates always succeed regardless.

## Privacy

- Email addresses are masked in `NotificationLog.recipientMasked` (`ab***@domain.com`).
- Raw `recipientEmail` is stored in the log for support use only.
- Internal order IDs are never included in email content.
- Tracking links use `trackingToken` (opaque UUID) only.

## Future Phases

- **SMS OTP**: Requires India DLT registration, sender ID, transactional template approval, and BSP selection (Twilio, MSG91, Exotel). Do not enable until DLT compliance is complete.
- **WhatsApp**: Meta WhatsApp Cloud API or approved BSP. Template inventory and consent wording required first.
- **Retry / webhook**: Add provider webhook callbacks and idempotent retry for delivery failures.
- **Customer notification preferences**: Respect opt-out before sending promotional or non-transactional messages.

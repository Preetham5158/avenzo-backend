# Fraud Prevention Plan

Current foundation:

- Phone number is required at checkout.
- Stable session/device ID is required.
- Order creation and lookup are rate-limited.
- Blocked phone and blocked device tables are enforced.
- Rejected and accepted order attempts are logged without raw IP storage.

## Future Signals

- OTP only for suspicious orders.
- High value order.
- Repeated attempts by the same phone.
- Many devices using the same phone.
- Many phones using the same device.
- Repeated payment failures.
- Payment required before restaurant-visible order.
- Restaurant manual blocking controls.
- Admin review queue for repeated rejected attempts.
- Safer customer claim flow before guest orders can be attached to an account.

## Current Safety Notes

- Guest orders require a phone number and are not automatically linked to customer accounts.
- IP addresses are hashed before storage.
- Blocked phone/device checks run before order creation.

## Payment Era

After payments are enabled, the restaurant kitchen queue should only show orders confirmed by trusted payment webhooks, unless the restaurant explicitly supports pay-at-counter mode.

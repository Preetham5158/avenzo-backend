# Notification Plan

Current mode: `NOTIFICATION_MODE=log`.
OTP mode: `OTP_MODE=log`.

No production email, SMS, or WhatsApp provider is configured in this pass. Order creation records/logs notification intent and must not fail because notification delivery fails.

Development log mode is allowed only outside production. OTP values must never be logged in production. If a real OTP provider is not configured while OTP is required, the login/verification flow must fail safely instead of pretending delivery worked.

## Providers To Evaluate

- Email: Amazon SES, SendGrid, Resend.
- SMS: Twilio, MSG91, Exotel.
- WhatsApp: Meta WhatsApp Cloud API or approved BSP.
- India SMS: confirm DLT registration, sender ID, consent language, template approval, and transactional/promotional separation before launch.

## Events

- Restaurant login OTP for approved restaurant users.
- Order confirmation after order creation.
- Order status update: preparing, ready, completed, cancelled.
- Future OTP for suspicious orders or phone verification.

## Failure Handling

- Log delivery intent and failures in `NotificationLog`.
- Do not block order creation on notification failure.
- Retry policy should be provider-specific and idempotent.

## Privacy

- Send only the minimum needed order details.
- Avoid exposing internal IDs.
- Respect notification consent wording before promotional messages.
- Mask recipients in notification logs where possible.

## Provider Setup Future

- Configure `SMS_PROVIDER` or `EMAIL_PROVIDER`.
- Set `FROM_EMAIL` and support contact values.
- Disable log OTP mode in production.
- Verify provider webhook/error callbacks before enabling mandatory production OTP.
- Add template inventory for order placed, order ready, order cancelled, restaurant login OTP, and support/deletion/correction contact messages.

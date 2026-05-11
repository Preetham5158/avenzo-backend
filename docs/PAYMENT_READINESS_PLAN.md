# Payment Readiness Plan

Current no-payment mode uses `PAYMENT_NOT_REQUIRED` for orders.

Order preparation status and payment status are separate:

- `Order.status`: kitchen/service workflow.
- `Order.paymentStatus`: payment lifecycle.

## Future Flow

1. Customer builds cart.
2. Checkout creates payment intent.
3. Order remains payment pending.
4. Provider webhook is source of truth.
5. Webhook confirms payment and makes the order visible to restaurant queue.

## Requirements

- Idempotent payment intent and webhook handling.
- Never trust frontend redirect alone.
- Refund and cancellation workflow.
- Reconciliation report for restaurants.
- Avoid showing unpaid orders in restaurant queue.
- Audit payment status changes.

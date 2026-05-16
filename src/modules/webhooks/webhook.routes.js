"use strict";
/**
 * Razorpay webhook handler.
 *
 * Requires the raw request body for HMAC-SHA256 signature verification.
 * The app-level express.json() `verify` callback stores rawBody on req for /webhooks/razorpay.
 *
 * Idempotency: webhookEvent table dedupes by (provider, eventId). Razorpay retries on 5xx
 * — the idempotency guard prevents double-processing of the same delivery.
 */

const express = require("express");
const crypto = require("crypto");

const { createPrismaClient } = require("../../prisma");
const { logRouteError } = require("../../lib/helpers");
const { auditLog } = require("../../services/auth.service");
const { notifyOrderConfirmation } = require("../../services/notification.service");

const prisma = createPrismaClient();
const router = express.Router();

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

router.post("/razorpay", async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        logRouteError("POST /webhooks/razorpay", new Error("RAZORPAY_WEBHOOK_SECRET not set"));
        return res.status(500).json({ error: "Webhook not configured" });
    }
    if (!signature || !req.rawBody) {
        return res.status(400).json({ error: "Missing signature or body" });
    }

    const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(String(signature), "hex");
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
        return res.status(400).json({ error: "Invalid signature" });
    }

    let event;
    try {
        event = typeof req.body === "string" ? JSON.parse(req.rawBody) : req.body;
    } catch {
        return res.status(400).json({ error: "Invalid payload" });
    }

    const eventType = event?.event;
    const razorpayEventId = event?.id;
    const payment = event?.payload?.payment?.entity;
    const rzpOrderId = payment?.order_id || event?.payload?.order?.entity?.id;

    if (!rzpOrderId) return res.json({ ok: true });

    try {
        // Idempotency: skip if this delivery was already processed.
        if (razorpayEventId) {
            const existing = await prisma.webhookEvent.findUnique({
                where: { provider_eventId: { provider: "razorpay", eventId: razorpayEventId } }
            });
            if (existing?.processedAt) return res.json({ ok: true });
        }

        // Persist the inbound event before mutating state so a crash never causes double-delivery.
        let webhookRecord = null;
        if (razorpayEventId) {
            webhookRecord = await prisma.webhookEvent.upsert({
                where: { provider_eventId: { provider: "razorpay", eventId: razorpayEventId } },
                update: {},
                create: { provider: "razorpay", eventId: razorpayEventId, eventType: eventType || "unknown", payload: event }
            });
        }

        const order = await prisma.order.findFirst({
            where: { razorpayOrderId: rzpOrderId },
            select: { id: true, trackingToken: true, orderNumber: true, pickupCode: true, paymentStatus: true, customerId: true, restaurantId: true, phone: true, customer: { select: { email: true } }, restaurant: { select: { name: true } } }
        });

        if (!order) {
            logRouteError("POST /webhooks/razorpay", new Error(`No order for razorpayOrderId=${rzpOrderId}`));
            if (webhookRecord) {
                await prisma.webhookEvent.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date(), error: "order_not_found" } });
            }
            return res.json({ ok: true });
        }

        if (eventType === "payment.captured" || eventType === "order.paid") {
            if (order.paymentStatus !== "PAID") {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: "PAID",
                        razorpayPaymentId: payment?.id || null
                    }
                });

                await auditLog("PAYMENT_CONFIRMED", {
                    restaurantId: order.restaurantId,
                    orderId: order.id,
                    metadata: { paymentEvent: eventType, razorpayPaymentId: payment?.id }
                });

                notifyOrderConfirmation({
                    prisma,
                    order,
                    restaurant: order.restaurant,
                    baseUrl: BASE_URL,
                    recipientEmail: order.customer?.email || null
                }).catch((err) => logRouteError("webhookNotifyConfirm", err));
            }
        } else if (eventType === "payment.failed") {
            if (!["PAYMENT_FAILED", "REFUNDED"].includes(order.paymentStatus)) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: "PAYMENT_FAILED",
                        // Auto-cancel so it never enters the kitchen queue.
                        status: "CANCELLED"
                    }
                });

                await auditLog("PAYMENT_FAILED", {
                    restaurantId: order.restaurantId,
                    orderId: order.id,
                    metadata: { paymentEvent: eventType }
                });
            }
        }

        if (webhookRecord) {
            await prisma.webhookEvent.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
        }

        return res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /webhooks/razorpay", err);
        // Return 500 so Razorpay retries — the idempotency guard above prevents double-processing.
        return res.status(500).json({ ok: false });
    }
});

module.exports = router;

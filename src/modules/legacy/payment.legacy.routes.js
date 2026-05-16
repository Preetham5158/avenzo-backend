"use strict";
// Legacy payment routes.

const express = require("express");
const Razorpay = require("razorpay");

const { createPrismaClient } = require("../../prisma");
const { cleanString, logRouteError, isValidHttpsUrl } = require("../../lib/helpers");
const { trackingLimiter, paymentLimiter } = require("../../config/rateLimiters");
const { authMiddleware } = require("../../middlewares/auth.middleware");
const { optionalAuth } = require("../../middlewares/auth.middleware");
const {
    isRestaurantServiceAvailable,
    getRestaurantAccess,
    auditLog,
} = require("../../services/auth.service");
const { getEnabledPaymentMethods } = require("../../services/order.service");
const { notifyOrderConfirmation } = require("../../services/notification.service");

const prisma = createPrismaClient();
const router = express.Router();
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

function getRazorpayInstance() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay credentials not configured");
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// Public: returns enabled payment methods for a restaurant so the frontend can show the selector.
router.get("/payment/methods", trackingLimiter, async (req, res) => {
    try {
        const slug = cleanString(req.query.slug, 140);
        let restaurantId = cleanString(req.query.restaurantId, 80);

        if (!slug && !restaurantId) return res.status(400).json({ error: "slug or restaurantId required" });

        if (slug && !restaurantId) {
            const r = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true } });
            if (!r) return res.status(404).json({ error: "Restaurant not found" });
            restaurantId = r.id;
        }

        const methods = await getEnabledPaymentMethods(restaurantId);
        res.json(methods.map(m => ({
            id: m.id,
            type: m.type,
            displayName: m.displayName,
            isDefault: m.isDefault,
            ...(m.type === "UPI_QR" && { qrImageUrl: m.qrImageUrl || null, upiId: m.upiId || null })
        })));
    } catch (err) {
        logRouteError("GET /payment/methods", err);
        res.status(500).json({ error: "Could not load payment methods" });
    }
});

// Customer submits a UPI payment claim. This does NOT mark the order as paid —
// it sets PAYMENT_CLAIMED so restaurant staff can verify in their UPI app before
// allowing the order into the kitchen.
router.post("/payment/upi-confirm", paymentLimiter, optionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        // Optional UTR / transaction ID provided by the customer.
        const paymentReference = cleanString(req.body.paymentReference, 120) || null;
        if (!trackingToken) return res.status(400).json({ error: "trackingToken required" });

        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, paymentStatus: true, paymentMethod: { select: { type: true } }, restaurantId: true }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.paymentStatus === "PAID") return res.json({ ok: true, alreadyPaid: true });
        if (order.paymentStatus === "PAYMENT_CLAIMED") return res.json({ ok: true, claimed: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return res.status(400).json({ error: "This order does not require payment" });
        if (order.paymentMethod?.type !== "UPI_QR") return res.status(400).json({ error: "This order is not a UPI QR payment" });

        // Mark as claimed — restaurant must verify before it can be prepared.
        await prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus: "PAYMENT_CLAIMED", ...(paymentReference && { paymentReference }) }
        });

        res.json({ ok: true, claimed: true });
    } catch (err) {
        logRouteError("POST /payment/upi-confirm", err);
        res.status(500).json({ error: "Could not submit payment claim" });
    }
});

// Restaurant/admin verifies UPI payment and marks it as confirmed PAID.
// Only callable by restaurant staff — the customer can never call this.
router.post("/admin/order/:id/confirm-payment", authMiddleware, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, paymentStatus: true, restaurantId: true, trackingToken: true,
                orderNumber: true, pickupCode: true, paymentReference: true,
                customer: { select: { email: true } },
                restaurant: { select: { name: true } }
            }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });

        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });

        if (order.paymentStatus === "PAID") return res.json({ ok: true, alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_CLAIMED") {
            return res.status(400).json({ error: "Order is not in a payment claimed state" });
        }

        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });

        await prisma.auditLog.create({
            data: {
                actorUserId: req.user.userId,
                action: "PAYMENT_CONFIRMED",
                restaurantId: order.restaurantId,
                orderId: order.id,
                metadata: { method: "UPI_MANUAL", confirmedFrom: "PAYMENT_CLAIMED" }
            }
        });

        notifyOrderConfirmation({
            prisma,
            order: { ...order },
            restaurant: order.restaurant,
            baseUrl: BASE_URL,
            recipientEmail: order.customer?.email || null
        }).catch((err) => logRouteError("confirmPaymentNotify", err));

        res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /admin/order/:id/confirm-payment", err);
        res.status(500).json({ error: "Could not confirm payment" });
    }
});

router.get("/admin/payment-methods/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const methods = await prisma.paymentMethod.findMany({
            where: { restaurantId: req.params.restaurantId },
            orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
        });
        res.json(methods);
    } catch (err) {
        logRouteError("GET /admin/payment-methods/:restaurantId", err);
        res.status(500).json({ error: "Could not load payment methods" });
    }
});

router.post("/admin/payment-methods/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const { type, displayName, isDefault, sortOrder, qrImageUrl, upiId } = req.body;
        const validTypes = ["RAZORPAY", "UPI_QR"];
        if (!validTypes.includes(type)) return res.status(400).json({ error: "type must be RAZORPAY or UPI_QR" });
        if (!cleanString(displayName, 80)) return res.status(400).json({ error: "displayName required" });
        if (qrImageUrl && !isValidHttpsUrl(qrImageUrl)) return res.status(400).json({ error: "qrImageUrl must be a valid https:// URL" });

        // Only one default at a time per restaurant.
        if (isDefault) {
            await prisma.paymentMethod.updateMany({ where: { restaurantId: req.params.restaurantId }, data: { isDefault: false } });
        }

        const method = await prisma.paymentMethod.create({
            data: {
                restaurantId: req.params.restaurantId,
                type,
                displayName: cleanString(displayName, 80),
                isEnabled: req.body.isEnabled !== false,
                isDefault: !!isDefault,
                sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
                qrImageUrl: cleanString(qrImageUrl, 500) || null,
                upiId: cleanString(upiId, 60) || null
            }
        });
        res.json(method);
    } catch (err) {
        logRouteError("POST /admin/payment-methods/:restaurantId", err);
        res.status(500).json({ error: "Could not create payment method" });
    }
});

router.put("/admin/payment-methods/:restaurantId/:id", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const existing = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, restaurantId: req.params.restaurantId } });
        if (!existing) return res.status(404).json({ error: "Payment method not found" });

        const { displayName, isEnabled, isDefault, sortOrder, qrImageUrl, upiId } = req.body;
        if (qrImageUrl && !isValidHttpsUrl(qrImageUrl)) return res.status(400).json({ error: "qrImageUrl must be a valid https:// URL" });

        if (isDefault) {
            await prisma.paymentMethod.updateMany({
                where: { restaurantId: req.params.restaurantId, id: { not: req.params.id } },
                data: { isDefault: false }
            });
        }

        const updated = await prisma.paymentMethod.update({
            where: { id: req.params.id },
            data: {
                ...(displayName !== undefined && { displayName: cleanString(displayName, 80) }),
                ...(isEnabled !== undefined && { isEnabled: !!isEnabled }),
                ...(isDefault !== undefined && { isDefault: !!isDefault }),
                ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
                ...(qrImageUrl !== undefined && { qrImageUrl: cleanString(qrImageUrl, 500) || null }),
                ...(upiId !== undefined && { upiId: cleanString(upiId, 60) || null })
            }
        });
        res.json(updated);
    } catch (err) {
        logRouteError("PUT /admin/payment-methods/:restaurantId/:id", err);
        res.status(500).json({ error: "Could not update payment method" });
    }
});

router.delete("/admin/payment-methods/:restaurantId/:id", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const existing = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, restaurantId: req.params.restaurantId } });
        if (!existing) return res.status(404).json({ error: "Payment method not found" });

        await prisma.paymentMethod.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("DELETE /admin/payment-methods/:restaurantId/:id", err);
        res.status(500).json({ error: "Could not delete payment method" });
    }
});

// Creates a Razorpay order for an existing PAYMENT_PENDING Avenzo order.
router.post("/payment/create", paymentLimiter, optionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        if (!trackingToken) return res.status(400).json({ error: "trackingToken required" });

        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: {
                id: true, totalPricePaise: true, paymentStatus: true, razorpayOrderId: true,
                restaurantId: true, paymentMethod: { select: { type: true } }
            }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.paymentStatus === "PAID") return res.json({ alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") {
            return res.status(400).json({ error: "This order does not require payment" });
        }
        // Only create Razorpay orders for RAZORPAY-type payment methods.
        if (order.paymentMethod?.type !== "RAZORPAY") {
            return res.status(400).json({ error: "This order uses a different payment method" });
        }

        // Ensure the restaurant is still active before initiating payment.
        const restaurantForPayment = await prisma.restaurant.findUnique({
            where: { id: order.restaurantId },
            select: { isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
        });
        if (!restaurantForPayment || !isRestaurantServiceAvailable(restaurantForPayment)) {
            return res.status(423).json({ error: "This restaurant is not currently accepting payments." });
        }

        // Validate credentials up-front so the error is user-friendly, not a 500.
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            logRouteError("POST /payment/create", new Error("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set"));
            return res.status(503).json({ error: "Online payment is temporarily unavailable. Please try another method or pay at the counter." });
        }

        const currency = process.env.RAZORPAY_CURRENCY || "INR";

        // Re-use existing Razorpay order if already created (idempotent).
        if (order.razorpayOrderId) {
            return res.json({ razorpayOrderId: order.razorpayOrderId, amount: order.totalPricePaise, currency, keyId });
        }

        const rzp = getRazorpayInstance();
        const rzpOrder = await rzp.orders.create({
            amount: order.totalPricePaise,
            currency,
            receipt: trackingToken,
            payment_capture: 1
        });

        await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rzpOrder.id } });

        res.json({ razorpayOrderId: rzpOrder.id, amount: order.totalPricePaise, currency, keyId });
    } catch (err) {
        logRouteError("POST /payment/create", err);
        res.status(500).json({ error: "Could not initiate payment. Please try again." });
    }
});

module.exports = router;

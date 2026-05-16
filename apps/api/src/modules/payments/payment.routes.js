"use strict";
/**
 * /api/v1 payment routes — Razorpay order creation, UPI claim, and restaurant manual confirm.
 *   POST /customer/payments/razorpay/create
 *   POST /customer/payments/upi/claim
 *   POST /restaurant/payments/manual-confirm
 */

const express = require("express");
const Razorpay = require("razorpay");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err } = require("../../lib/response");
const { cleanString, logRouteError } = require("../../lib/helpers");
const { v1Auth, v1OptionalAuth } = require("../../middlewares/auth.middleware");
const { paymentLimiter } = require("../../config/rateLimiters");
const {
    getRestaurantAccess,
    isRestaurantServiceAvailable,
    auditLog,
} = require("../../services/auth.service");
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

router.post("/customer/payments/razorpay/create", paymentLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        if (!trackingToken) return v1err(res, "VALIDATION_ERROR", "trackingToken required");
        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, totalPricePaise: true, paymentStatus: true, razorpayOrderId: true, restaurantId: true, paymentMethod: { select: { type: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return v1err(res, "BAD_REQUEST", "This order does not require payment");
        if (order.paymentMethod?.type !== "RAZORPAY") return v1err(res, "BAD_REQUEST", "This order uses a different payment method");

        const restaurantForPay = await prisma.restaurant.findUnique({
            where: { id: order.restaurantId },
            select: { isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
        });
        if (!restaurantForPay || !isRestaurantServiceAvailable(restaurantForPay))
            return v1err(res, "SERVICE_UNAVAILABLE", "Restaurant not currently accepting payments", 423);

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) return v1err(res, "SERVICE_UNAVAILABLE", "Online payment temporarily unavailable", 503);
        const currency = process.env.RAZORPAY_CURRENCY || "INR";

        if (order.razorpayOrderId) {
            return v1ok(res, { razorpayOrderId: order.razorpayOrderId, amount: order.totalPricePaise, currency, keyId });
        }
        const rzp = getRazorpayInstance();
        const rzpOrder = await rzp.orders.create({ amount: order.totalPricePaise, currency, receipt: trackingToken, payment_capture: 1 });
        await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rzpOrder.id } });
        return v1ok(res, { razorpayOrderId: rzpOrder.id, amount: order.totalPricePaise, currency, keyId });
    } catch (err) {
        logRouteError("POST /api/v1/customer/payments/razorpay/create", err);
        return v1err(res, "SERVER_ERROR", "Could not initiate payment", 500);
    }
});

router.post("/customer/payments/upi/claim", paymentLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        const paymentReference = cleanString(req.body.paymentReference, 120) || null;
        if (!trackingToken) return v1err(res, "VALIDATION_ERROR", "trackingToken required");
        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, paymentStatus: true, paymentMethod: { select: { type: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus === "PAYMENT_CLAIMED") return v1ok(res, { claimed: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return v1err(res, "BAD_REQUEST", "This order does not require payment");
        if (order.paymentMethod?.type !== "UPI_QR") return v1err(res, "BAD_REQUEST", "This order is not a UPI payment");
        await prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus: "PAYMENT_CLAIMED", ...(paymentReference && { paymentReference }) }
        });
        return v1ok(res, { claimed: true });
    } catch (err) {
        logRouteError("POST /api/v1/customer/payments/upi/claim", err);
        return v1err(res, "SERVER_ERROR", "Could not submit payment claim", 500);
    }
});

router.post("/restaurant/payments/manual-confirm", v1Auth, async (req, res) => {
    try {
        const orderId = cleanString(req.body.orderId, 80);
        if (!orderId) return v1err(res, "VALIDATION_ERROR", "orderId required");
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, paymentStatus: true, restaurantId: true, trackingToken: true, orderNumber: true, pickupCode: true, customer: { select: { email: true } }, restaurant: { select: { name: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_CLAIMED") return v1err(res, "BAD_REQUEST", "Order is not in a payment claimed state");
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
        await auditLog("PAYMENT_CONFIRMED", { actorUserId: req.user.userId, restaurantId: order.restaurantId, orderId: order.id, metadata: { method: "UPI_MANUAL", via: "v1" } });
        notifyOrderConfirmation({
            prisma, order, restaurant: order.restaurant, baseUrl: BASE_URL,
            recipientEmail: order.customer?.email || null
        }).catch(() => {});
        return v1ok(res, { confirmed: true });
    } catch (err) {
        logRouteError("POST /api/v1/restaurant/payments/manual-confirm", err);
        return v1err(res, "SERVER_ERROR", "Could not confirm payment", 500);
    }
});

module.exports = router;

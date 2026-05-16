"use strict";
/**
 * /api/v1 customer + restaurant order routes.
 *
 * Customer:
 *   POST   /customer/orders
 *   GET    /customer/orders
 *   GET    /customer/orders/:trackingToken
 *   GET    /customer/orders/:trackingToken/payment-status
 *   POST   /customer/orders/:trackingToken/cancel
 *   POST   /customer/orders/:trackingToken/rating
 *
 * Restaurant:
 *   GET    /restaurant/orders
 *   GET    /restaurant/orders/:id
 *   PATCH  /restaurant/orders/:id/status
 *
 * Critical: PATCH .../status must enforce payment guard before moving to PREPARING.
 */

const express = require("express");
const crypto = require("crypto");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err, v1list } = require("../../lib/response");
const { cleanString, logRouteError } = require("../../lib/helpers");
const { ORDER_STATUS_TRANSITIONS } = require("../../lib/constants");
const { publicMenuKey } = require("../../utils/token");
const { isValidPhone, normalizePhone } = require("../../utils/phone");
const { publicOrderResponse, customerOrderSummary } = require("../../serializers/order.serializer");
const { v1Auth, v1OptionalAuth } = require("../../middlewares/auth.middleware");
const {
    orderLimiter,
    trackingLimiter,
} = require("../../config/rateLimiters");
const {
    getAuthUser,
    getRestaurantAccess,
    isRestaurantServiceAvailable,
    restaurantServiceMessage,
    auditLog,
} = require("../../services/auth.service");
const {
    getPopularMenuIds,
    getEnabledPaymentMethods,
    getIdempotentResponse,
    setIdempotentResponse,
} = require("../../services/order.service");
const { notifyOrderConfirmation, notifyOrderStatus } = require("../../services/notification.service");
const { checkOrderAbuse, hashIp, logOrderAttempt } = require("../../services/abuse.service");
const { submitRating } = require("../../services/rating.service");

const prisma = createPrismaClient();
const router = express.Router();

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

// ── Customer Orders ─────────────────────────────────────────────────────────────

router.post("/customer/orders", orderLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const { items, sessionId, phone, restaurantSlug, restaurantId: rId,
            paymentMethodId, tableNumber, idempotencyKey, guest } = req.body;

        const deviceId = cleanString(sessionId, 120);
        const restaurantSlug_ = cleanString(restaurantSlug, 140);
        let restaurantId = cleanString(rId, 80);
        const ipHash = hashIp(req.ip);

        if (!Array.isArray(items) || items.length === 0 || items.length > 40)
            return v1err(res, "VALIDATION_ERROR", "Items required (max 40)");
        if (!deviceId || deviceId.length < 8) return v1err(res, "VALIDATION_ERROR", "Valid sessionId required");
        if (!restaurantId && !restaurantSlug_) return v1err(res, "VALIDATION_ERROR", "restaurantId or restaurantSlug required");

        const normalizedItems = items.map(i => ({
            menuId: String(i.menuId || ""), menuKey: String(i.menuKey || ""),
            quantity: Number(i.quantity)
        }));
        if (normalizedItems.some(i => (!i.menuId && !i.menuKey) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20))
            return v1err(res, "VALIDATION_ERROR", "Check item quantities (1–20 per item)");

        const restaurant = restaurantSlug_
            ? await prisma.restaurant.findUnique({ where: { slug: restaurantSlug_ }, select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true } })
            : await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true } });

        if (!restaurant) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
        restaurantId = restaurant.id;

        if (!isRestaurantServiceAvailable(restaurant)) {
            await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "REJECTED", reason: "restaurant_unavailable" });
            return v1err(res, "SERVICE_UNAVAILABLE", restaurantServiceMessage(restaurant), 423);
        }

        const guestOrder = guest === true;
        let customer = null;
        let shouldSaveCustomerPhone = false;
        if (req.user?.userId && !guestOrder) {
            customer = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { id: true, role: true, phone: true } });
            if (!customer || customer.role !== "USER") customer = null;
        }

        let normalizedPhone = normalizePhone(String(phone || ""));
        if (!normalizedPhone && customer?.phone) normalizedPhone = normalizePhone(customer.phone);
        if (customer && !customer.phone && normalizedPhone) shouldSaveCustomerPhone = true;
        if (!normalizedPhone) return v1err(res, "VALIDATION_ERROR", "Valid phone number required");

        const abuse = await checkOrderAbuse(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash });
        if (!abuse.allowed) {
            await auditLog("ORDER_ATTEMPT_REJECTED", { restaurantId, metadata: { reason: abuse.reason } });
            return v1err(res, "RATE_LIMITED", abuse.reason, 429);
        }

        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            const cached = await getIdempotentResponse(cacheKey);
            if (cached) return v1ok(res, cached);
        }

        const pickupCode = crypto.randomInt(1000, 10000).toString();
        const trackingToken = crypto.randomUUID();
        const enabledMethods = await getEnabledPaymentMethods(restaurantId);
        let resolvedPaymentMethodId = null;
        if (enabledMethods.length > 0) {
            if (paymentMethodId) {
                const match = enabledMethods.find(m => m.id === paymentMethodId);
                if (!match) return v1err(res, "VALIDATION_ERROR", "Invalid payment method");
                resolvedPaymentMethodId = match.id;
            } else {
                resolvedPaymentMethodId = enabledMethods[0].id;
            }
        }
        const requiresPayment = resolvedPaymentMethodId !== null;

        const hasPublicMenuKeys = normalizedItems.some(i => i.menuKey);
        const menuItems = await prisma.menu.findMany({
            where: hasPublicMenuKeys
                ? { restaurantId, isActive: true }
                : { id: { in: normalizedItems.map(i => i.menuId) }, restaurantId, isActive: true }
        });

        let totalPricePaise = 0;
        for (const i of normalizedItems) {
            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
            if (!menu) return v1err(res, "VALIDATION_ERROR", "One or more items are invalid");
            if (!menu.isAvailable) return v1err(res, "ITEM_UNAVAILABLE", `${menu.name} is not available`);
            totalPricePaise += menu.pricePaise * i.quantity;
        }

        const order = await prisma.$transaction(async (tx) => {
            const counter = await tx.restaurant.update({
                where: { id: restaurantId }, data: { orderCounter: { increment: 1 } }, select: { orderCounter: true }
            });
            return tx.order.create({
                data: {
                    orderNumber: counter.orderCounter - 1, totalPricePaise,
                    paymentStatus: requiresPayment ? "PAYMENT_PENDING" : "PAYMENT_NOT_REQUIRED",
                    pickupCode, trackingToken, sessionId: deviceId, phone: normalizedPhone,
                    tableNumber: tableNumber || null,
                    ...(resolvedPaymentMethodId && { paymentMethodId: resolvedPaymentMethodId }),
                    ...(customer && { customerId: customer.id }),
                    restaurantId,
                    items: {
                        create: normalizedItems.map(i => {
                            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
                            return { menuId: menu.id, quantity: i.quantity, priceAtOrderPaise: menu.pricePaise, nameAtOrder: menu.name };
                        })
                    }
                }
            });
        });

        await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "ACCEPTED", reason: "order_created" });
        if (shouldSaveCustomerPhone) {
            prisma.user.update({ where: { id: customer.id }, data: { phone: normalizedPhone } }).catch(() => {});
        }

        const selectedMethod = resolvedPaymentMethodId ? enabledMethods.find(m => m.id === resolvedPaymentMethodId) || null : null;
        const responseData = {
            trackingToken: order.trackingToken,
            orderNumber: order.orderNumber,
            pickupCode,
            paymentStatus: order.paymentStatus,
            paymentMethod: selectedMethod ? {
                id: selectedMethod.id, type: selectedMethod.type, displayName: selectedMethod.displayName,
                ...(selectedMethod.type === "UPI_QR" && { qrImageUrl: selectedMethod.qrImageUrl || null, upiId: selectedMethod.upiId || null })
            } : null,
            trackingUrl: `${BASE_URL}/track/${order.trackingToken}`
        };

        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            setIdempotentResponse(cacheKey, responseData).catch(() => {});
        }

        notifyOrderConfirmation({ prisma, order, restaurant, baseUrl: BASE_URL, recipientEmail: customer ? null : null })
            .catch((err) => logRouteError("v1:notifyOrderConfirmation", err));

        return v1ok(res, responseData, 201);
    } catch (err) {
        logRouteError("POST /api/v1/customer/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not place order", 500);
    }
});

router.get("/customer/orders", v1Auth, async (req, res) => {
    try {
        if (req.user.role !== "USER") return v1err(res, "FORBIDDEN", "Customer accounts only", 403);
        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
        const skip = (page - 1) * limit;
        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: { customerId: req.user.userId },
                include: { items: true, restaurant: { select: { name: true, slug: true } } },
                orderBy: { createdAt: "desc" }, skip, take: limit
            }),
            prisma.order.count({ where: { customerId: req.user.userId } })
        ]);
        return v1list(res,
            orders.map(o => customerOrderSummary(o)),
            { page, limit, total, hasMore: skip + orders.length < total }
        );
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch orders", 500);
    }
});

router.get("/customer/orders/:trackingToken", v1OptionalAuth, trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            include: {
                items: { include: { menu: { select: { name: true, imageUrl: true } } } },
                restaurant: { select: { name: true, slug: true, address: true, pickupNote: true } },
                paymentMethod: { select: { id: true, type: true, displayName: true, qrImageUrl: true, upiId: true } },
                rating: { select: { rating: true, comment: true } }
            }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        return v1ok(res, publicOrderResponse(order, { includeInternalId: false }));
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders/:trackingToken", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch order", 500);
    }
});

router.get("/customer/orders/:trackingToken/payment-status", trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            select: { paymentStatus: true, status: true, trackingToken: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        return v1ok(res, { paymentStatus: order.paymentStatus, orderStatus: order.status });
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders/:trackingToken/payment-status", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch payment status", 500);
    }
});

router.post("/customer/orders/:trackingToken/cancel", orderLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            select: { id: true, status: true, customerId: true, paymentStatus: true, restaurantId: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.status === "CANCELLED") return v1ok(res, { cancelled: true });
        if (order.status !== "PENDING") {
            return v1err(res, "BAD_REQUEST", "This order is already being prepared and cannot be cancelled. Please speak to the restaurant.", 400);
        }
        if (order.paymentStatus === "PAID") {
            return v1err(res, "BAD_REQUEST", "A paid order cannot be self-cancelled. Please contact the restaurant.", 400);
        }
        if (order.customerId && !req.user?.userId) {
            return v1err(res, "UNAUTHORIZED", "Please sign in again.", 401);
        }
        if (order.customerId && order.customerId !== req.user.userId) {
            return v1err(res, "FORBIDDEN", "You cannot cancel this order.", 403);
        }
        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await auditLog("ORDER_STATUS_UPDATED", {
            restaurantId: order.restaurantId,
            orderId: order.id,
            actorUserId: req.user?.userId || null,
            metadata: { to: "CANCELLED", source: "customer_self_cancel" }
        });
        return v1ok(res, { cancelled: true });
    } catch (err) {
        logRouteError("POST /api/v1/customer/orders/:trackingToken/cancel", err);
        return v1err(res, "SERVER_ERROR", "Could not cancel order", 500);
    }
});

router.post("/customer/orders/:trackingToken/rating", orderLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const ratingVal = Number(req.body.rating);
        if (!Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5) {
            return v1err(res, "VALIDATION_ERROR", "Rating must be between 1 and 5 stars");
        }
        const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 500) : null;
        await submitRating(prisma, {
            trackingToken: req.params.trackingToken,
            rating: ratingVal,
            comment,
            userId: req.user?.userId || null
        });
        return v1ok(res, { rated: true, message: "Thank you for your feedback!" });
    } catch (err) {
        if (err.status) return v1err(res, "BAD_REQUEST", err.message, err.status);
        logRouteError("POST /api/v1/customer/orders/:trackingToken/rating", err);
        return v1err(res, "SERVER_ERROR", "Could not save your rating", 500);
    }
});

// ── Restaurant Orders ───────────────────────────────────────────────────────────

router.get("/restaurant/orders", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user || user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant access only", 403);

        let restaurantId = cleanString(req.query.restaurantId, 80);
        if (!restaurantId) {
            if (user.role === "RESTAURANT_OWNER") {
                const r = await prisma.restaurant.findFirst({ where: { ownerId: user.id }, select: { id: true } });
                restaurantId = r?.id;
            } else if (user.role === "EMPLOYEE") {
                restaurantId = user.staffRestaurantId;
            }
        }
        if (!restaurantId) return v1err(res, "BAD_REQUEST", "restaurantId required");

        const access = await getRestaurantAccess(restaurantId, user.id);
        if (!access.canAccess) return v1err(res, "FORBIDDEN", "Not allowed", 403);

        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
        const requestedStatus = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (requestedStatus && !validStatuses.includes(requestedStatus)) {
            return v1err(res, "VALIDATION_ERROR", "Invalid status filter");
        }

        const isKitchenView = req.query.kitchen === "true" ||
            (requestedStatus && ["PENDING", "PREPARING", "READY"].includes(requestedStatus));
        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
        const skip = (page - 1) * limit;

        const where = {
            restaurantId,
            ...(requestedStatus && { status: requestedStatus }),
            ...(isKitchenView && { paymentStatus: { notIn: ["PAYMENT_PENDING"] } })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, include: { items: true, paymentMethod: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
            prisma.order.count({ where })
        ]);

        return v1list(res,
            orders.map(o => publicOrderResponse(o, { includeInternalId: true })),
            { page, limit, total, hasMore: skip + orders.length < total }
        );
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch orders", 500);
    }
});

router.get("/restaurant/orders/:id", v1Auth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: { items: true, paymentMethod: true, restaurant: { select: { id: true, name: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canAccess) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        return v1ok(res, publicOrderResponse(order, { includeInternalId: true }));
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/orders/:id", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch order", 500);
    }
});

router.patch("/restaurant/orders/:id/status", v1Auth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, status: true, restaurantId: true, paymentStatus: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);

        const newStatus = String(req.body.status || "").toUpperCase();
        const allowed = ORDER_STATUS_TRANSITIONS[order.status] || [];
        if (!allowed.includes(newStatus)) {
            return v1err(res, "VALIDATION_ERROR", `Cannot move order from ${order.status} to ${newStatus}`);
        }
        // Block PREPARING until payment is fully resolved — neither pending nor customer-claimed is enough.
        if (newStatus === "PREPARING" && ["PAYMENT_PENDING", "PAYMENT_CLAIMED"].includes(order.paymentStatus)) {
            return v1err(res, "PAYMENT_REQUIRED", "Order payment has not been confirmed yet", 402);
        }
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: { status: newStatus, ...(newStatus === "READY" && { readyAt: new Date() }) }
        });
        await auditLog("ORDER_STATUS_UPDATED", { actorUserId: req.user.userId, restaurantId: order.restaurantId, orderId: order.id, metadata: { from: order.status, to: newStatus } });
        notifyOrderStatus({ prisma, order: updated, baseUrl: BASE_URL }).catch(() => {});
        return v1ok(res, { id: updated.id, status: updated.status, orderNumber: updated.orderNumber });
    } catch (err) {
        logRouteError("PATCH /api/v1/restaurant/orders/:id/status", err);
        return v1err(res, "SERVER_ERROR", "Could not update order status", 500);
    }
});

module.exports = router;

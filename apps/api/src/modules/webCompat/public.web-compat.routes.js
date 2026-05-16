"use strict";
// webCompat routes — serve current static apps/api/public/ HTML frontend during migration to Next.js apps. New clients must use /api/v1 exclusively.

const express = require("express");
const crypto = require("crypto");

const { createPrismaClient } = require("../../prisma");
const {
    cleanString,
    isValidEmail,
    logRouteError,
    menuFoodFilter,
} = require("../../lib/helpers");
const { normalizePhone, isValidPhone } = require("../../utils/phone");
const { publicMenuKey } = require("../../utils/token");
const { paiseToRupees, rupeesToPaise } = require("../../utils/money");
const {
    orderLimiter,
    orderLookupLimiter,
    trackingLimiter,
    restaurantInterestLimiter,
} = require("../../config/rateLimiters");
const { optionalAuth } = require("../../middlewares/auth.middleware");
const { publicMenuItem } = require("../../serializers/menu.serializer");
const { publicOrderResponse } = require("../../serializers/order.serializer");
const { checkOrderAbuse, hashIp, logOrderAttempt } = require("../../services/abuse.service");
const { notifyOrderConfirmation } = require("../../services/notification.service");
const { submitRating } = require("../../services/rating.service");
const {
    isRestaurantServiceAvailable,
    restaurantServiceMessage,
    publicRestaurantResponse,
    auditLog,
} = require("../../services/auth.service");
const { getPopularMenuIds, getEnabledPaymentMethods: getEnabledPaymentMethodsSvc, getIdempotentResponse: getIdempotentResponseSvc, setIdempotentResponse: setIdempotentResponseSvc } = require("../../services/order.service");

const prisma = createPrismaClient();
const router = express.Router();
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

// Use service-layer helpers — shared with v1 routes for consistency.
const getIdempotentResponse = getIdempotentResponseSvc;
const setIdempotentResponse = setIdempotentResponseSvc;
const getEnabledPaymentMethods = getEnabledPaymentMethodsSvc;

router.get("/restaurant/slug/:slug", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug: req.params.slug },
        });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

        const ratingData = await prisma.orderRating.aggregate({
            where: { restaurantId: restaurant.id },
            _avg: { rating: true },
            _count: { rating: true }
        });

        res.json({
            ...publicRestaurantResponse(restaurant),
            avgRating: ratingData._avg.rating ? Math.round(ratingData._avg.rating * 10) / 10 : null,
            ratingCount: ratingData._count.rating
        });
    } catch (err) {
        logRouteError("GET /restaurant/slug/:slug", err);
        res.status(500).json({ error: "Error fetching restaurant" });
    }
});

router.get("/restaurant/:id", async (req, res) => {
    try {
        const [restaurant, ratingData] = await Promise.all([
            prisma.restaurant.findUnique({ where: { id: req.params.id } }),
            prisma.orderRating.aggregate({
                where: { restaurantId: req.params.id },
                _avg: { rating: true },
                _count: { rating: true }
            })
        ]);
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

        res.json({
            ...publicRestaurantResponse(restaurant),
            avgRating: ratingData._avg.rating ? Math.round(ratingData._avg.rating * 10) / 10 : null,
            ratingCount: ratingData._count.rating
        });
    } catch (err) {
        logRouteError("GET /restaurant/:id", err);
        res.status(500).json({ error: "Error fetching restaurant" });
    }
});

router.get("/menu/:restaurantId", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId } });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
        if (!isRestaurantServiceAvailable(restaurant)) {
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        const [menu, popularIds] = await Promise.all([
            prisma.menu.findMany({
                where: {
                    restaurantId: req.params.restaurantId,
                    isActive: true,
                    ...menuFoodFilter(req.query.foodType)
                },
                include: { category: true },
                orderBy: [{ isAvailable: "desc" }, { category: { name: "asc" } }]
            }),
            getPopularMenuIds(req.params.restaurantId)
        ]);

        res.json(menu.map(item => publicMenuItem(item, { popularIds })));
    } catch (err) {
        logRouteError("GET /menu/:restaurantId", err);
        res.status(500).json({ error: "Error fetching menu" });
    }
});

router.get("/menu/by-slug/:slug", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug } });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
        if (!isRestaurantServiceAvailable(restaurant)) {
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        const [menu, popularIds] = await Promise.all([
            prisma.menu.findMany({
                where: { restaurantId: restaurant.id, isActive: true, ...menuFoodFilter(req.query.foodType) },
                include: { category: true },
                orderBy: [{ isAvailable: "desc" }, { category: { sortOrder: "asc" } }, { name: "asc" }]
            }),
            getPopularMenuIds(restaurant.id)
        ]);

        res.json(menu.map(item => publicMenuItem(item, { popularIds })));
    } catch (err) {
        logRouteError("GET /menu/by-slug/:slug", err);
        res.status(500).json({ error: "Error fetching menu" });
    }
});

router.get("/reviews/restaurant/:slug", trackingLimiter, async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug: req.params.slug },
            select: { id: true }
        });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 30);
        const skip = (page - 1) * limit;

        const where = { restaurantId: restaurant.id, comment: { not: null } };
        const [reviews, total] = await Promise.all([
            prisma.orderRating.findMany({
                where,
                select: { rating: true, comment: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit
            }),
            prisma.orderRating.count({ where })
        ]);

        res.json({
            reviews,
            pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
        });
    } catch (err) {
        logRouteError("GET /reviews/restaurant/:slug", err);
        res.status(500).json({ error: "Could not load reviews" });
    }
});

router.post("/order", orderLimiter, optionalAuth, async (req, res) => {
    try {
        const { items, sessionId, phone } = req.body;
        const idempotencyKey = cleanString(req.body.idempotencyKey, 100);
        const tableNumber = cleanString(req.body.tableNumber, 40) || null;
        const paymentMethodId = cleanString(req.body.paymentMethodId, 80) || null;
        const guestOrder = req.body.guest === true;
        let restaurantId = cleanString(req.body.restaurantId, 80);
        const restaurantSlug = cleanString(req.body.restaurantSlug, 140);
        const ipHash = hashIp(req.ip);

        if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
            return res.status(400).json({ error: "Items required" });
        }
        if ((!restaurantId && !restaurantSlug) || !sessionId) {
            return res.status(400).json({ error: "Missing data" });
        }

        const deviceId = String(sessionId || "").trim();
        if (deviceId.length < 8 || deviceId.length > 120) {
            return res.status(400).json({ error: "Invalid session" });
        }

        const normalizedItems = items.map(i => ({
            menuId: String(i.menuId || ""),
            menuKey: String(i.menuKey || ""),
            quantity: Number(i.quantity)
        }));

        if (normalizedItems.some(i => (!i.menuId && !i.menuKey) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20)) {
            return res.status(400).json({ error: "Please check item quantities" });
        }

        const restaurant = restaurantSlug
            ? await prisma.restaurant.findUnique({
                where: { slug: restaurantSlug },
                select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
            })
            : await prisma.restaurant.findUnique({
                where: { id: restaurantId },
                select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
            });

        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
        restaurantId = restaurant.id;

        if (!isRestaurantServiceAvailable(restaurant)) {
            await logOrderAttempt(prisma, { restaurantId, phone: normalizePhone(phone), deviceId, ipHash, status: "REJECTED", reason: "restaurant_unavailable" });
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        let customer = null;
        if (!guestOrder && req.user?.userId) {
            customer = await prisma.user.findUnique({
                where: { id: req.user.userId },
                select: { id: true, email: true, role: true, phone: true }
            });
            if (!customer) return res.status(401).json({ error: "Invalid customer account" });
            if (customer.role !== "USER") {
                return res.status(403).json({ error: "Use a customer account to place customer orders" });
            }
        }

        // Guest orders stay separate from accounts until a future verified claim flow exists.
        let normalizedPhone = normalizePhone(phone);
        const shouldSaveCustomerPhone = !!customer && !customer.phone && !!normalizedPhone;
        if (!normalizedPhone && customer?.phone) normalizedPhone = normalizePhone(customer.phone);

        if (!normalizedPhone) {
            await logOrderAttempt(prisma, { restaurantId, phone: null, deviceId, ipHash, status: "REJECTED", reason: "missing_phone" });
            return res.status(400).json({ error: "Mobile number is required to place an order" });
        }

        if (!isValidPhone(normalizedPhone)) {
            await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "REJECTED", reason: "invalid_phone" });
            return res.status(400).json({ error: "Invalid phone number" });
        }

        const abuse = await checkOrderAbuse(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash });
        if (!abuse.allowed) {
            await auditLog("ORDER_ATTEMPT_REJECTED", { restaurantId, metadata: { reason: abuse.reason } });
            return res.status(429).json({ error: abuse.reason });
        }

        // Return cached result if client retries the same order submit.
        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            const cached = await getIdempotentResponse(cacheKey);
            if (cached) return res.json(cached);
        }

        const pickupCode = crypto.randomInt(1000, 10000).toString();
        const trackingToken = crypto.randomUUID();

        // Resolve payment: check if the supplied method is valid for this restaurant.
        const enabledMethods = await getEnabledPaymentMethods(restaurantId);
        let resolvedPaymentMethodId = null;
        if (enabledMethods.length > 0) {
            if (paymentMethodId) {
                const match = enabledMethods.find(m => m.id === paymentMethodId);
                if (!match) return res.status(400).json({ error: "Invalid payment method" });
                resolvedPaymentMethodId = match.id;
            } else {
                // Default to the first enabled method (sorted by isDefault desc, sortOrder asc).
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
        normalizedItems.forEach(i => {
            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
            if (!menu) throw new Error("Invalid item");
            if (!menu.isAvailable) throw new Error(`${menu.name} is unavailable`);
            totalPricePaise += menu.pricePaise * i.quantity;
        });

        const order = await prisma.$transaction(async (tx) => {
            const counter = await tx.restaurant.update({
                where: { id: restaurantId },
                data: { orderCounter: { increment: 1 } },
                select: { orderCounter: true }
            });
            return tx.order.create({
                data: {
                    orderNumber: counter.orderCounter - 1,
                    totalPricePaise,
                    paymentStatus: requiresPayment ? "PAYMENT_PENDING" : "PAYMENT_NOT_REQUIRED",
                    pickupCode,
                    trackingToken,
                    sessionId: deviceId,
                    phone: normalizedPhone,
                    tableNumber: tableNumber || null,
                    ...(resolvedPaymentMethodId && { paymentMethodId: resolvedPaymentMethodId }),
                    // Signed-in customer orders attach customerId so they appear in My Orders.
                    ...(customer && { customerId: customer.id }),
                    restaurantId,
                    items: {
                        create: normalizedItems.map(i => {
                            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
                            return {
                                menuId: menu.id,
                                quantity: i.quantity,
                                priceAtOrderPaise: menu.pricePaise,
                                nameAtOrder: menu.name
                            };
                        })
                    }
                }
            });
        });

        await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "ACCEPTED", reason: "order_created" });

        if (shouldSaveCustomerPhone) {
            prisma.user.update({ where: { id: customer.id }, data: { phone: normalizedPhone } })
                .catch((err) => logRouteError("saveCustomerPhoneAfterOrder", err));
        }

        notifyOrderConfirmation({ prisma, order, restaurant, baseUrl: BASE_URL, recipientEmail: customer?.email })
            .catch((err) => logRouteError("notifyOrderConfirmation", err));

        // Include enough payment context for the frontend to route to the right payment UI.
        const selectedMethod = resolvedPaymentMethodId
            ? enabledMethods.find(m => m.id === resolvedPaymentMethodId) || null
            : null;

        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            const cachePayload = {
                trackingToken: order.trackingToken,
                orderNumber: order.orderNumber,
                pickupCode,
                paymentStatus: order.paymentStatus,
                paymentMethod: selectedMethod ? { id: selectedMethod.id, type: selectedMethod.type, displayName: selectedMethod.displayName, ...(selectedMethod.type === "UPI_QR" && { qrImageUrl: selectedMethod.qrImageUrl || null, upiId: selectedMethod.upiId || null }) } : null,
                message: "Order placed.",
                trackingUrl: `${BASE_URL}/track/${order.trackingToken}`
            };
            setIdempotentResponse(cacheKey, cachePayload).catch(() => {});
        }

        res.json({
            trackingToken: order.trackingToken,
            orderNumber: order.orderNumber,
            pickupCode,
            paymentStatus: order.paymentStatus,
            paymentMethod: selectedMethod
                ? {
                    id: selectedMethod.id,
                    type: selectedMethod.type,
                    displayName: selectedMethod.displayName,
                    ...(selectedMethod.type === "UPI_QR" && { qrImageUrl: selectedMethod.qrImageUrl || null, upiId: selectedMethod.upiId || null })
                }
                : null,
            message: "Order placed. We will send confirmation updates when available.",
            trackingUrl: `${BASE_URL}/track/${order.trackingToken}`
        });
    } catch (err) {
        logRouteError("POST /order", err);
        const knownOrderError = err.message === "Invalid item" || String(err.message || "").endsWith(" is unavailable");
        res.status(knownOrderError ? 400 : 500).json({
            error: knownOrderError ? err.message : "We could not place the order. Please try again."
        });
    }
});

router.get("/order/:trackingToken", trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            include: { items: true, restaurant: true, rating: true, paymentMethod: true }
        });
        if (!order) return res.status(404).json({ error: "Not found" });
        res.json(publicOrderResponse(order));
    } catch (err) {
        logRouteError("GET /order/:trackingToken", err);
        res.status(500).json({ error: "Error fetching order" });
    }
});

router.get("/orders/lookup", orderLookupLimiter, async (req, res) => {
    try {
        let restaurantId = cleanString(req.query.restaurantId, 80);
        const restaurantSlug = cleanString(req.query.restaurantSlug, 140);
        const phone = normalizePhone(req.query.phone);

        if ((!restaurantId && !restaurantSlug) || !phone || !isValidPhone(phone)) {
            return res.status(400).json({ error: "Enter the same mobile number used for ordering" });
        }

        if (!restaurantId && restaurantSlug) {
            const restaurant = await prisma.restaurant.findUnique({ where: { slug: restaurantSlug }, select: { id: true } });
            if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
            restaurantId = restaurant.id;
        }

        const orders = await prisma.order.findMany({
            where: { restaurantId, phone },
            select: { trackingToken: true, orderNumber: true, pickupCode: true, status: true, totalPricePaise: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 5
        });

        res.json({
            orders: orders.map((order) => {
                const { totalPricePaise, ...safeOrder } = order;
                return { ...safeOrder, totalPrice: paiseToRupees(totalPricePaise) };
            })
        });
    } catch (err) {
        logRouteError("GET /orders/lookup", err);
        res.status(500).json({ error: "Error finding orders" });
    }
});

// Customer self-cancel — only allowed while status is PENDING and payment is not PAID.
router.post("/order/:trackingToken/cancel", orderLimiter, optionalAuth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            select: { id: true, status: true, customerId: true, paymentStatus: true, restaurantId: true }
        });
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.status === "CANCELLED") return res.json({ ok: true });
        if (order.status !== "PENDING") {
            return res.status(400).json({ error: "This order is already being prepared and cannot be cancelled. Please speak to the restaurant." });
        }
        if (order.paymentStatus === "PAID") {
            return res.status(400).json({ error: "A paid order cannot be self-cancelled. Please contact the restaurant." });
        }
        // Account-owned orders require the signed-in customer; guest orders remain token-protected.
        if (order.customerId && !req.user?.userId) return res.status(401).json({ error: "Please sign in again." });
        if (order.customerId && order.customerId !== req.user.userId) {
            return res.status(403).json({ error: "You cannot cancel this order." });
        }
        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await auditLog("ORDER_STATUS_UPDATED", {
            restaurantId: order.restaurantId,
            orderId: order.id,
            actorUserId: req.user?.userId || null,
            metadata: { to: "CANCELLED", source: "customer_self_cancel" }
        });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /order/:trackingToken/cancel", err);
        res.status(500).json({ error: "Could not cancel order" });
    }
});

// Global guest order lookup by phone + pickup code — no restaurant context needed.
router.get("/orders/find", orderLookupLimiter, async (req, res) => {
    try {
        const phone = normalizePhone(req.query.phone);
        const code = cleanString(req.query.code, 10);
        if (!phone || !isValidPhone(phone) || !code) {
            return res.status(400).json({ error: "Mobile number and order code are required" });
        }
        // Limit lookups to the last 48 hours to avoid exposing old orders.
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const order = await prisma.order.findFirst({
            where: { phone, pickupCode: code, createdAt: { gte: since } },
            select: { trackingToken: true }
        });
        if (!order) return res.status(404).json({ error: "No order found. Check your mobile number and the code shown at checkout." });
        res.json({ trackingToken: order.trackingToken });
    } catch (err) {
        logRouteError("GET /order/find", err);
        res.status(500).json({ error: "Could not find order" });
    }
});

router.post("/restaurant-interest", restaurantInterestLimiter, async (req, res) => {
    try {
        const restaurantName = cleanString(req.body.restaurantName, 140);
        const contactName = cleanString(req.body.contactName, 140);
        const phone = cleanString(req.body.phone, 40);
        const email = cleanString(req.body.email, 180);
        const location = cleanString(req.body.location, 180);
        const restaurantType = cleanString(req.body.restaurantType, 120);
        const approxDailyOrders = cleanString(req.body.approxDailyOrders, 80);
        const message = cleanString(req.body.message, 1000);

        if (!restaurantName || !contactName || !phone || !email || !location) {
            return res.status(400).json({ error: "Restaurant name, contact name, phone, email, and location are required" });
        }
        if (!isValidEmail(email)) return res.status(400).json({ error: "Use a valid email address" });
        if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) return res.status(400).json({ error: "Use a valid phone number" });

        await prisma.restaurantLead.create({
            data: { restaurantName, contactName, phone, email: email.toLowerCase(), location, restaurantType, approxDailyOrders, message }
        });

        res.status(201).json({ message: "Thanks for your interest. The Avenzo team will get back to you soon." });
    } catch (err) {
        logRouteError("POST /restaurant-interest", err);
        res.status(500).json({ error: "Could not save your interest right now" });
    }
});

// One rating per completed order; guests use trackingToken, customers also verified by userId.
router.post("/order/:trackingToken/rating", orderLimiter, optionalAuth, async (req, res) => {
    try {
        const ratingVal = Number(req.body.rating);
        if (!Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5) {
            return res.status(400).json({ error: "Rating must be between 1 and 5 stars" });
        }
        const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 500) : null;
        await submitRating(prisma, {
            trackingToken: req.params.trackingToken,
            rating: ratingVal,
            comment,
            userId: req.user?.userId || null
        });
        res.json({ ok: true, message: "Thank you for your feedback!" });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        logRouteError("POST /order/:trackingToken/rating", err);
        res.status(500).json({ error: "Could not save your rating" });
    }
});

module.exports = router;

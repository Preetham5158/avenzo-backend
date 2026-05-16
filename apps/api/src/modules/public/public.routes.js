"use strict";
/**
 * /api/v1/public — anonymous restaurant browsing, menu, payment methods, order lookup.
 * Mounted at /api/v1 so paths read /api/v1/public/...
 *
 * Public APIs never expose internal IDs beyond what serializers permit.
 */

const express = require("express");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err } = require("../../lib/response");
const { cleanString, menuFoodFilter, logRouteError } = require("../../lib/helpers");
const { paiseToRupees } = require("../../utils/money");
const { isValidPhone, normalizePhone } = require("../../utils/phone");
const { publicMenuItem } = require("../../serializers/menu.serializer");
const {
    publicRestaurantResponse,
    isRestaurantServiceAvailable,
    restaurantServiceMessage,
} = require("../../services/auth.service");
const {
    getPopularMenuIds,
    getEnabledPaymentMethods,
} = require("../../services/order.service");
const { trackingLimiter, orderLookupLimiter } = require("../../config/rateLimiters");

const prisma = createPrismaClient();
const router = express.Router();

router.get("/restaurants/:slug", trackingLimiter, async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug } });
        if (!restaurant) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
        const ratingData = await prisma.orderRating.aggregate({
            where: { restaurantId: restaurant.id },
            _avg: { rating: true }, _count: { rating: true }
        });
        return v1ok(res, {
            ...publicRestaurantResponse(restaurant),
            avgRating: ratingData._avg.rating ? Math.round(ratingData._avg.rating * 10) / 10 : null,
            ratingCount: ratingData._count.rating
        });
    } catch (err) {
        logRouteError("GET /api/v1/public/restaurants/:slug", err);
        return v1err(res, "SERVER_ERROR", "Could not load restaurant", 500);
    }
});

router.get("/restaurants/:slug/menu", trackingLimiter, async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug } });
        if (!restaurant) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
        if (!isRestaurantServiceAvailable(restaurant)) {
            return v1err(res, "SERVICE_UNAVAILABLE", restaurantServiceMessage(restaurant), 423);
        }
        const foodFilter = menuFoodFilter(req.query.foodType);
        const [menu, categories, popularIds] = await Promise.all([
            prisma.menu.findMany({
                where: { restaurantId: restaurant.id, isActive: true, ...foodFilter },
                include: { category: true },
                orderBy: [{ category: { sortOrder: "asc" } }, { category: { name: "asc" } }]
            }),
            prisma.category.findMany({
                where: { restaurantId: restaurant.id },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
            }),
            getPopularMenuIds(restaurant.id)
        ]);
        const paymentMethods = await getEnabledPaymentMethods(restaurant.id);
        return v1ok(res, {
            restaurant: publicRestaurantResponse(restaurant),
            categories,
            items: menu.map(item => ({
                ...publicMenuItem(item),
                isPopular: popularIds.has(item.id)
            })),
            paymentMethods: paymentMethods.map(m => ({
                id: m.id, type: m.type, displayName: m.displayName, isDefault: m.isDefault,
                ...(m.type === "UPI_QR" && { qrImageUrl: m.qrImageUrl || null, upiId: m.upiId || null })
            }))
        });
    } catch (err) {
        logRouteError("GET /api/v1/public/restaurants/:slug/menu", err);
        return v1err(res, "SERVER_ERROR", "Could not load menu", 500);
    }
});

router.get("/payment-methods", trackingLimiter, async (req, res) => {
    try {
        const { slug, restaurantId: rId } = req.query;
        if (!slug && !rId) return v1err(res, "BAD_REQUEST", "slug or restaurantId required");
        let restaurantId = rId;
        if (slug && !restaurantId) {
            const r = await prisma.restaurant.findUnique({ where: { slug: String(slug) }, select: { id: true } });
            if (!r) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
            restaurantId = r.id;
        }
        const methods = await getEnabledPaymentMethods(restaurantId);
        return v1ok(res, methods.map(m => ({
            id: m.id, type: m.type, displayName: m.displayName, isDefault: m.isDefault,
            ...(m.type === "UPI_QR" && { qrImageUrl: m.qrImageUrl || null, upiId: m.upiId || null })
        })));
    } catch (err) {
        logRouteError("GET /api/v1/public/payment-methods", err);
        return v1err(res, "SERVER_ERROR", "Could not load payment methods", 500);
    }
});

router.get("/orders/lookup", orderLookupLimiter, async (req, res) => {
    try {
        let restaurantId = cleanString(req.query.restaurantId, 80);
        const restaurantSlug = cleanString(req.query.restaurantSlug, 140);
        const phone = normalizePhone(req.query.phone);
        if ((!restaurantId && !restaurantSlug) || !phone || !isValidPhone(phone)) {
            return v1err(res, "VALIDATION_ERROR", "Enter the same mobile number used for ordering");
        }
        if (!restaurantId && restaurantSlug) {
            const r = await prisma.restaurant.findUnique({ where: { slug: restaurantSlug }, select: { id: true } });
            if (!r) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
            restaurantId = r.id;
        }
        const orders = await prisma.order.findMany({
            where: { restaurantId, phone },
            select: { trackingToken: true, orderNumber: true, pickupCode: true, status: true, totalPricePaise: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 5
        });
        return v1ok(res, {
            orders: orders.map(o => ({
                trackingToken: o.trackingToken,
                orderNumber: o.orderNumber,
                pickupCode: o.pickupCode,
                status: o.status,
                totalPrice: paiseToRupees(o.totalPricePaise),
                createdAt: o.createdAt
            }))
        });
    } catch (err) {
        logRouteError("GET /api/v1/public/orders/lookup", err);
        return v1err(res, "SERVER_ERROR", "Could not find orders", 500);
    }
});

router.get("/orders/find", orderLookupLimiter, async (req, res) => {
    try {
        const phone = normalizePhone(req.query.phone);
        const code = cleanString(req.query.code, 10);
        if (!phone || !isValidPhone(phone) || !code) {
            return v1err(res, "VALIDATION_ERROR", "Mobile number and order code are required");
        }
        // Limit lookups to the last 48 hours to avoid exposing old orders.
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const order = await prisma.order.findFirst({
            where: { phone, pickupCode: code, createdAt: { gte: since } },
            select: { trackingToken: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "No order found. Check your mobile number and the code shown at checkout.", 404);
        return v1ok(res, { trackingToken: order.trackingToken });
    } catch (err) {
        logRouteError("GET /api/v1/public/orders/find", err);
        return v1err(res, "SERVER_ERROR", "Could not find order", 500);
    }
});

module.exports = router;

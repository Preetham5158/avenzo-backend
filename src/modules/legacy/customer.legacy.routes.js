"use strict";
// Legacy customer routes. Prefer /api/v1/me and /api/v1/customer/orders

const express = require("express");

const { createPrismaClient } = require("../../prisma");
const { cleanString, logRouteError } = require("../../lib/helpers");
const { normalizePhone, isValidPhone } = require("../../utils/phone");
const { paiseToRupees } = require("../../utils/money");
const { authMiddleware } = require("../../middlewares/auth.middleware");
const { customerOrderSummary } = require("../../serializers/order.serializer");
const { getAuthUser, customerRestaurantResponse } = require("../../services/auth.service");

const prisma = createPrismaClient();
const router = express.Router();

router.get("/customer/profile", authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { email: true, name: true, phone: true, role: true }
        });
        if (!user) return res.status(401).json({ error: "Invalid user" });
        if (user.role !== "USER") return res.status(403).json({ error: "Customer profile is available only for customer accounts" });
        const { role, ...profile } = user;
        res.json({ profile });
    } catch (err) {
        logRouteError("GET /customer/profile", err);
        res.status(500).json({ error: "Error fetching profile" });
    }
});

router.patch("/customer/profile", authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, role: true }
        });
        if (!user) return res.status(401).json({ error: "Invalid user" });
        if (user.role !== "USER") return res.status(403).json({ error: "Customer profile is available only for customer accounts" });

        const data = {};
        const nameProvided = Object.prototype.hasOwnProperty.call(req.body, "name");
        const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, "phone");
        const name = nameProvided ? cleanString(req.body.name, 120) : undefined;
        const rawPhone = phoneProvided ? cleanString(req.body.phone, 40) : undefined;
        const phone = rawPhone ? normalizePhone(rawPhone) : null;

        if (phoneProvided && rawPhone && !phone) {
            return res.status(400).json({ error: "Use a valid phone number" });
        }

        if (nameProvided) data.name = name;
        if (phoneProvided) data.phone = phone;

        const updated = await prisma.user.update({
            where: { id: user.id },
            data,
            select: { email: true, name: true, phone: true }
        });

        res.json({ profile: updated, message: "Profile updated" });
    } catch (err) {
        logRouteError("PATCH /customer/profile", err);
        res.status(500).json({ error: "Could not update profile" });
    }
});

router.get("/customer/restaurants", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return res.status(401).json({ error: "Invalid user" });
        if (user.role !== "USER") return res.status(403).json({ error: "Customer restaurant discovery is available only for customer accounts" });

        const [restaurants, ratingAgg] = await Promise.all([
            prisma.restaurant.findMany({
                where: { isActive: true },
                include: {
                    menus: {
                        where: { isActive: true, isAvailable: true, imageUrl: { not: null } },
                        select: { imageUrl: true },
                        take: 4
                    }
                },
                orderBy: [{ locality: "asc" }, { name: "asc" }]
            }),
            prisma.orderRating.groupBy({
                by: ["restaurantId"],
                _avg: { rating: true },
                _count: { rating: true }
            })
        ]);
        const ratingMap = new Map(ratingAgg.map(r => [r.restaurantId, r]));

        res.json({
            restaurants: restaurants.map(r => {
                const rd = ratingMap.get(r.id);
                return {
                    ...customerRestaurantResponse(r),
                    avgRating: rd?._avg.rating ? Math.round(rd._avg.rating * 10) / 10 : null,
                    ratingCount: rd?._count.rating || 0
                };
            })
        });
    } catch (err) {
        logRouteError("GET /customer/restaurants", err);
        res.status(500).json({ error: "Error fetching restaurants" });
    }
});

router.get("/customer/orders", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return res.status(401).json({ error: "Invalid user" });
        if (user.role !== "USER") return res.status(403).json({ error: "Customer orders are available only for customer accounts" });

        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
        const requestedStatus = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (requestedStatus && !validStatuses.includes(requestedStatus)) {
            return res.status(400).json({ error: "Invalid order status filter" });
        }

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
        const restaurantSlug = cleanString(req.query.restaurant, 120);

        const where = {
            customerId: user.id,
            ...(requestedStatus && { status: requestedStatus }),
            ...(restaurantSlug && { restaurant: { slug: restaurantSlug } })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    restaurant: { select: { name: true, slug: true, locality: true, address: true } },
                    rating: { select: { rating: true } }
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            orders: orders.map(customerOrderSummary),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        logRouteError("GET /customer/orders", err);
        res.status(500).json({ error: "Error fetching customer orders" });
    }
});

module.exports = router;

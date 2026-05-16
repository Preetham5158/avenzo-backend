"use strict";
// webCompat routes — serve current static apps/api/public/ HTML frontend during migration to Next.js apps. New clients must use /api/v1 exclusively.

const express = require("express");

const { createPrismaClient } = require("../../prisma");
const {
    cleanString,
    isValidEmail,
    logRouteError,
    normalizeSlug,
    normalizeFoodType,
    normalizeRestaurantFoodType,
    normalizeSubscriptionStatus,
    allowedNextOrderStatuses,
    restaurantFoodTypeAllowsItem,
    incompatibleFoodTypeMessage,
} = require("../../lib/helpers");
const { LEAD_STATUSES } = require("../../lib/constants");
const { rupeesToPaise, paiseToRupees } = require("../../utils/money");
const { authMiddleware } = require("../../middlewares/auth.middleware");
const { publicMenuItem, adminMenuItem } = require("../../serializers/menu.serializer");
const { publicOrderResponse } = require("../../serializers/order.serializer");
const { notifyOrderStatus } = require("../../services/notification.service");
const {
    getAuthUser,
    isSuperAdmin,
    isOwner,
    isEmployee,
    getRestaurantAccess,
    ensureWorkspaceService,
    getUserPermissions,
    auditLog,
} = require("../../services/auth.service");

const prisma = createPrismaClient();
const router = express.Router();
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

router.get("/categories/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const categories = await prisma.category.findMany({
            where: { restaurantId: req.params.restaurantId },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
        });

        res.json(categories);
    } catch (err) {
        logRouteError("GET /categories/:restaurantId", err);
        res.status(500).json({ error: "Error fetching categories" });
    }
});

router.get("/restaurants", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return res.status(401).json({ error: "Invalid user" });
        // Customer accounts are intentionally kept out of the restaurant/admin shell.
        if (user.role === "USER") {
            return res.status(403).json({
                error: "This area is for approved Avenzo restaurant partners. Please use your customer account to browse restaurants and track orders."
            });
        }

        const restaurants = await prisma.restaurant.findMany({
            where: isSuperAdmin(user)
                ? {}
                : isOwner(user)
                    ? { ownerId: user.id }
                    : { id: user.staffRestaurantId || "__none__" },
            include: { owner: { select: { id: true, email: true, name: true } } },
            orderBy: { createdAt: "desc" }
        });

        const permissions = getUserPermissions(user);
        res.json({
            user,
            restaurants,
            canCreateRestaurant: permissions.canCreateRestaurant,
            canEditRestaurants: permissions.canEditRestaurants
        });
    } catch (err) {
        logRouteError("GET /restaurants", err);
        res.status(500).json({ error: "Error fetching restaurants" });
    }
});

router.post("/restaurant", authMiddleware, async (req, res) => {
    try {
        const { name, address, locality, pickupNote, ownerEmail, subscriptionStatus, subscriptionEndsAt, isActive, foodType } = req.body;
        if (!name) return res.status(400).json({ error: "Name required" });

        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only super admins can create restaurants" });

        const slug = normalizeSlug(name);
        let owner = user;
        if (ownerEmail) {
            const ownerRecord = await prisma.user.findUnique({ where: { email: String(ownerEmail).toLowerCase().trim() } });
            if (!ownerRecord) return res.status(400).json({ error: "Owner email must belong to an existing account" });
            owner = await prisma.user.update({ where: { id: ownerRecord.id }, data: { role: "RESTAURANT_OWNER" } });
        }

        const restaurant = await prisma.restaurant.create({
            data: {
                name,
                slug,
                address: address || null,
                locality: locality || null,
                pickupNote: pickupNote || null,
                foodType: normalizeRestaurantFoodType(foodType),
                ownerId: owner.id,
                isActive: typeof isActive === "boolean" ? isActive : true,
                subscriptionStatus: normalizeSubscriptionStatus(subscriptionStatus),
                subscriptionEndsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt) : null
            }
        });

        await auditLog("RESTAURANT_CREATED", {
            actorUserId: user.id,
            restaurantId: restaurant.id,
            targetUserId: owner.id,
            metadata: { subscriptionStatus: restaurant.subscriptionStatus }
        });

        res.json(restaurant);
    } catch (err) {
        logRouteError("POST /restaurant", err);
        res.status(500).json({ error: "Error creating restaurant" });
    }
});

router.put("/restaurant/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, locality, pickupNote, ownerEmail, isActive, subscriptionStatus, subscriptionEndsAt, foodType } = req.body;
        if (!name) return res.status(400).json({ error: "Name required" });

        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only the Avenzo admin team can edit restaurant details" });

        let ownerId;
        if (ownerEmail) {
            const ownerRecord = await prisma.user.findUnique({ where: { email: String(ownerEmail).toLowerCase().trim() } });
            if (!ownerRecord) return res.status(400).json({ error: "Owner email must belong to an existing account" });
            const owner = await prisma.user.update({ where: { id: ownerRecord.id }, data: { role: "RESTAURANT_OWNER" } });
            ownerId = owner.id;
        }

        const before = await prisma.restaurant.findUnique({
            where: { id },
            select: { subscriptionStatus: true, subscriptionEndsAt: true }
        });

        const updated = await prisma.restaurant.update({
            where: { id },
            data: {
                name,
                ...(ownerId && { ownerId }),
                ...(typeof address !== "undefined" && { address: address || null }),
                ...(typeof locality !== "undefined" && { locality: locality || null }),
                ...(typeof pickupNote !== "undefined" && { pickupNote: pickupNote || null }),
                ...(typeof foodType !== "undefined" && { foodType: normalizeRestaurantFoodType(foodType) }),
                ...(typeof isActive === "boolean" && { isActive }),
                ...(subscriptionStatus && { subscriptionStatus: normalizeSubscriptionStatus(subscriptionStatus) }),
                ...(typeof subscriptionEndsAt !== "undefined" && { subscriptionEndsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt) : null })
            }
        });

        await auditLog(
            before?.subscriptionStatus !== updated.subscriptionStatus ||
                String(before?.subscriptionEndsAt || "") !== String(updated.subscriptionEndsAt || "")
                ? "SUBSCRIPTION_UPDATED"
                : "RESTAURANT_UPDATED",
            {
                actorUserId: user.id,
                restaurantId: updated.id,
                metadata: { subscriptionStatus: updated.subscriptionStatus, subscriptionEndsAt: updated.subscriptionEndsAt }
            }
        );

        res.json(updated);
    } catch (err) {
        logRouteError("PUT /restaurant/:id", err);
        res.status(500).json({ error: "Error updating restaurant" });
    }
});

router.delete("/restaurant/:id", authMiddleware, async (req, res) => {
    res.status(405).json({ error: "Restaurants are deactivated instead of deleted" });
});

router.post("/category", authMiddleware, async (req, res) => {
    try {
        const { name, restaurantId, sortOrder } = req.body;
        if (!name || !restaurantId) return res.status(400).json({ error: "Missing fields" });

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can manage menu categories" });
        if (!ensureWorkspaceService(access, res)) return;

        const category = await prisma.category.upsert({
            where: { restaurantId_name: { restaurantId, name: name.trim() } },
            update: { ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) }) },
            create: { name: name.trim(), restaurantId, ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) }) }
        });

        res.json(category);
    } catch (err) {
        logRouteError("POST /category", err);
        res.status(500).json({ error: "Error saving category" });
    }
});

router.patch("/admin/categories/:restaurantId/reorder", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can reorder categories" });

        const order = req.body.order;
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: "order array of { id, sortOrder } required" });
        }
        await prisma.$transaction(
            order.map(({ id, sortOrder }) =>
                prisma.category.updateMany({ where: { id, restaurantId }, data: { sortOrder: Number(sortOrder) } })
            )
        );
        res.json({ ok: true });
    } catch (err) {
        logRouteError("PATCH /admin/categories/:restaurantId/reorder", err);
        res.status(500).json({ error: "Could not reorder categories" });
    }
});

router.post("/menu", authMiddleware, async (req, res) => {
    try {
        const { name, price, categoryId, restaurantId, description, imageUrl, foodType } = req.body;
        const pricePaise = rupeesToPaise(price);
        if (!name || pricePaise === null || !categoryId || !restaurantId) {
            return res.status(400).json({ error: "Missing or invalid fields" });
        }

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can add menu items" });
        if (!ensureWorkspaceService(access, res)) return;

        const category = await prisma.category.findFirst({ where: { id: categoryId, restaurantId }, select: { id: true } });
        if (!category) return res.status(400).json({ error: "Invalid category" });

        const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { foodType: true } });
        const normalizedFoodType = normalizeFoodType(foodType);
        if (!restaurantFoodTypeAllowsItem(restaurant?.foodType, normalizedFoodType)) {
            return res.status(400).json({ error: incompatibleFoodTypeMessage(restaurant?.foodType) });
        }

        const item = await prisma.menu.create({
            data: { name, pricePaise, categoryId, restaurantId, foodType: normalizedFoodType, description: description || null, imageUrl: imageUrl || null },
            include: { category: true }
        });

        res.json(publicMenuItem(item));
    } catch (err) {
        logRouteError("POST /menu", err);
        res.status(500).json({ error: "Error saving menu item" });
    }
});

router.put("/menu/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, categoryId, isAvailable, isActive, description, imageUrl, foodType } = req.body;
        const pricePaise = typeof price !== "undefined" ? rupeesToPaise(price) : undefined;
        if (typeof price !== "undefined" && pricePaise === null) {
            return res.status(400).json({ error: "Invalid price" });
        }

        const item = await prisma.menu.findUnique({ where: { id }, select: { restaurantId: true } });
        if (!item) return res.status(404).json({ error: "Not found" });

        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const requestedKeys = Object.keys(req.body);
        if (access.isEmployee) {
            const onlyStock = requestedKeys.length === 1 && typeof isAvailable === "boolean";
            if (!onlyStock) return res.status(403).json({ error: "Team members can only update stock availability" });
        } else if (!access.canManage) {
            return res.status(403).json({ error: "Only owners can edit menu details" });
        }

        if (categoryId) {
            const category = await prisma.category.findFirst({ where: { id: categoryId, restaurantId: item.restaurantId }, select: { id: true } });
            if (!category) return res.status(400).json({ error: "Invalid category" });
        }

        let normalizedFoodType;
        if (typeof foodType !== "undefined") {
            normalizedFoodType = normalizeFoodType(foodType);
            const restaurant = await prisma.restaurant.findUnique({ where: { id: item.restaurantId }, select: { foodType: true } });
            if (!restaurantFoodTypeAllowsItem(restaurant?.foodType, normalizedFoodType)) {
                return res.status(400).json({ error: incompatibleFoodTypeMessage(restaurant?.foodType) });
            }
        }

        const updated = await prisma.menu.update({
            where: { id },
            data: {
                ...(typeof name !== "undefined" && { name }),
                ...(typeof price !== "undefined" && pricePaise !== null && { pricePaise }),
                ...(categoryId && { categoryId }),
                ...(normalizedFoodType && { foodType: normalizedFoodType }),
                ...(typeof isAvailable !== "undefined" && { isAvailable }),
                ...(!access.isEmployee && typeof isActive !== "undefined" && { isActive }),
                ...(typeof description !== "undefined" && { description: description || null }),
                ...(typeof imageUrl !== "undefined" && { imageUrl: imageUrl || null })
            },
            include: { category: true }
        });

        res.json(publicMenuItem(updated));
    } catch (err) {
        logRouteError("PUT /menu/:id", err);
        res.status(500).json({ error: "Error updating menu item" });
    }
});

router.delete("/menu/:id", authMiddleware, async (req, res) => {
    try {
        const item = await prisma.menu.findUnique({ where: { id: req.params.id }, select: { restaurantId: true, name: true } });
        if (!item) return res.status(404).json({ error: "Not found" });
        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can delete menu items" });
        if (!ensureWorkspaceService(access, res)) return;
        await prisma.menu.delete({ where: { id: req.params.id } });
        await auditLog("MENU_ITEM_DELETED", { restaurantId: item.restaurantId, actorUserId: req.user.userId, metadata: { itemName: item.name } });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("DELETE /menu/:id", err);
        res.status(500).json({ error: "Could not delete menu item" });
    }
});

router.patch("/order/:id/status", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

        if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });

        const order = await prisma.order.findUnique({
            where: { id },
            select: {
                id: true, restaurantId: true, readyAt: true, status: true, paymentStatus: true,
                trackingToken: true, pickupCode: true, orderNumber: true,
                customer: { select: { email: true } },
                restaurant: { select: { name: true } }
            }
        });

        if (!order) return res.status(404).json({ error: "Not found" });

        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        // Block kitchen actions until payment is fully confirmed — neither pending nor customer-claimed is sufficient.
        if (order.paymentStatus === "PAYMENT_PENDING") {
            return res.status(402).json({ error: "Payment is pending. Status cannot be updated until payment is confirmed." });
        }
        if (order.paymentStatus === "PAYMENT_CLAIMED") {
            return res.status(402).json({ error: "Customer has claimed payment but it has not been verified yet. Please confirm payment received before preparing the order." });
        }

        if (order.status === status) return res.json({ id: order.id, status: order.status });

        const allowed = allowedNextOrderStatuses(order.status);
        if (!allowed.includes(status)) {
            return res.status(409).json({ error: `Cannot change order from ${order.status} to ${status}`, allowedStatuses: allowed });
        }

        const data = { status };
        if (status === "READY" && !order.readyAt) data.readyAt = new Date();

        const updated = await prisma.order.update({ where: { id }, data });

        await auditLog("ORDER_STATUS_UPDATED", {
            actorUserId: req.user.userId, restaurantId: order.restaurantId, orderId: order.id,
            metadata: { from: order.status, to: status }
        });

        notifyOrderStatus({
            prisma, order, restaurant: order.restaurant, status, baseUrl: BASE_URL,
            recipientEmail: order.customer?.email || null
        }).catch((err) => logRouteError("notifyOrderStatus", err));

        res.json(updated);
    } catch (err) {
        logRouteError("PATCH /order/:id/status", err);
        res.status(500).json({ error: "Error updating order status" });
    }
});

router.get("/admin/dashboard/stats", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user || user.role === "USER") return res.status(403).json({ error: "Not allowed" });

        const restaurants = await prisma.restaurant.findMany({
            where: isSuperAdmin(user)
                ? {}
                : isOwner(user)
                    ? { ownerId: user.id }
                    : { id: user.staffRestaurantId || "__none__" },
            select: { id: true }
        });

        const restaurantIds = restaurants.map(r => r.id);
        if (!restaurantIds.length) {
            return res.json({ ordersToday: 0, revenueToday: 0, activeOrders: 0, outOfStock: 0 });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [ordersToday, revenueResult, activeOrders, outOfStock] = await Promise.all([
            prisma.order.count({ where: { restaurantId: { in: restaurantIds }, createdAt: { gte: todayStart } } }),
            prisma.order.aggregate({
                where: { restaurantId: { in: restaurantIds }, createdAt: { gte: todayStart }, status: "COMPLETED" },
                _sum: { totalPricePaise: true }
            }),
            prisma.order.count({ where: { restaurantId: { in: restaurantIds }, status: { in: ["PENDING", "PREPARING"] } } }),
            prisma.menu.count({ where: { restaurantId: { in: restaurantIds }, isAvailable: false, isActive: true } })
        ]);

        res.json({
            ordersToday,
            revenueToday: paiseToRupees(revenueResult._sum.totalPricePaise || 0),
            activeOrders,
            outOfStock
        });
    } catch (err) {
        logRouteError("GET /admin/dashboard/stats", err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

router.get("/admin/menu/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const [menu, categories, restaurant] = await Promise.all([
            prisma.menu.findMany({
                where: { restaurantId },
                include: { category: true },
                orderBy: [{ category: { sortOrder: "asc" } }, { createdAt: "desc" }]
            }),
            prisma.category.findMany({ where: { restaurantId }, orderBy: { sortOrder: "asc" } }),
            prisma.restaurant.findUnique({
                where: { id: restaurantId },
                select: { id: true, name: true, foodType: true, isActive: true, subscriptionStatus: true, address: true, locality: true }
            })
        ]);

        res.json({ items: menu.map(adminMenuItem), categories, restaurant });
    } catch (err) {
        logRouteError("GET /admin/menu/:restaurantId", err);
        res.status(500).json({ error: "Error fetching admin menu" });
    }
});

router.get("/admin/orders/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { id: true, name: true, address: true, locality: true, pickupNote: true, foodType: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
        });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
        const requestedStatus = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (requestedStatus && !validStatuses.includes(requestedStatus)) {
            return res.status(400).json({ error: "Invalid order status filter" });
        }

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
        const skip = (page - 1) * limit;

        // Kitchen-mode: when caller only wants active/actionable orders, suppress orders
        // still awaiting payment. PAYMENT_CLAIMED is included — restaurant must verify it
        // before the order can be prepared.
        const isKitchenView = req.query.kitchen === "true" ||
            (requestedStatus && ["PENDING", "PREPARING", "READY"].includes(requestedStatus));

        const where = {
            restaurantId,
            ...(requestedStatus && { status: requestedStatus }),
            ...(isKitchenView && { paymentStatus: { notIn: ["PAYMENT_PENDING"] } })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, include: { items: true, paymentMethod: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
            prisma.order.count({ where })
        ]);

        res.json({
            restaurant,
            orders: orders.map((order) => publicOrderResponse(order, { includeInternalId: true })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        logRouteError("GET /admin/orders/:restaurantId", err);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

router.get("/admin/restaurant-leads", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can view restaurant leads" });

        const status = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (status && !LEAD_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid lead status" });

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
        const search = cleanString(req.query.search, 120);
        const where = {
            ...(status && { status }),
            ...(search && {
                OR: [
                    { restaurantName: { contains: search, mode: "insensitive" } },
                    { contactName: { contains: search, mode: "insensitive" } },
                    { phone: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                    { location: { contains: search, mode: "insensitive" } }
                ]
            })
        };

        const [leads, total, statusCounts, unseenNewCount] = await Promise.all([
            prisma.restaurantLead.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
            prisma.restaurantLead.count({ where }),
            prisma.restaurantLead.groupBy({ by: ["status"], _count: { status: true } }),
            prisma.restaurantLead.count({ where: { status: "NEW", viewedAt: null } })
        ]);

        res.json({
            leads,
            counts: statusCounts.reduce((acc, item) => { acc[item.status] = item._count.status; return acc; }, {}),
            unseenNewCount,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        logRouteError("GET /admin/restaurant-leads", err);
        res.status(500).json({ error: "Error fetching restaurant leads" });
    }
});

router.get("/admin/restaurant-leads/summary", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can view restaurant leads" });

        const [statusCounts, unseenNewCount] = await Promise.all([
            prisma.restaurantLead.groupBy({ by: ["status"], _count: { status: true } }),
            prisma.restaurantLead.count({ where: { status: "NEW", viewedAt: null } })
        ]);

        res.json({
            counts: statusCounts.reduce((acc, item) => { acc[item.status] = item._count.status; return acc; }, {}),
            unseenNewCount
        });
    } catch (err) {
        logRouteError("GET /admin/restaurant-leads/summary", err);
        res.status(500).json({ error: "Error fetching lead summary" });
    }
});

router.post("/admin/restaurant-leads/mark-seen", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can update restaurant leads" });
        await prisma.restaurantLead.updateMany({ where: { status: "NEW", viewedAt: null }, data: { viewedAt: new Date() } });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /admin/restaurant-leads/mark-seen", err);
        res.status(500).json({ error: "Error updating leads" });
    }
});

router.patch("/admin/restaurant-leads/:id", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can update restaurant leads" });

        const data = {};
        if (typeof req.body.status !== "undefined") {
            const status = String(req.body.status).toUpperCase();
            if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid lead status" });
            data.status = status;
            data.viewedAt = new Date();
        }
        if (typeof req.body.internalNote !== "undefined") {
            data.internalNote = cleanString(req.body.internalNote, 1000);
        }

        const lead = await prisma.restaurantLead.update({ where: { id: req.params.id }, data });
        res.json({ lead });
    } catch (err) {
        logRouteError("PATCH /admin/restaurant-leads/:id", err);
        res.status(500).json({ error: "Error updating lead" });
    }
});

router.get("/admin/staff/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only admins and restaurant owners can manage staff" });
        if (!ensureWorkspaceService(access, res)) return;

        const staff = await prisma.user.findMany({
            where: { staffRestaurantId: req.params.restaurantId },
            select: { id: true, email: true, name: true, role: true, createdAt: true },
            orderBy: { email: "asc" }
        });

        res.json({ staff });
    } catch (err) {
        logRouteError("GET /admin/staff/:restaurantId", err);
        res.status(500).json({ error: "Error fetching staff" });
    }
});

router.post("/admin/staff/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only admins and restaurant owners can manage staff" });
        if (!ensureWorkspaceService(access, res)) return;

        const email = cleanString(req.body.email, 180);
        if (!email || !isValidEmail(email)) return res.status(400).json({ error: "Use an existing employee email address" });

        const staffUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!staffUser) return res.status(404).json({ error: "That user account does not exist yet" });
        if (["ADMIN", "RESTAURANT_OWNER"].includes(staffUser.role)) {
            return res.status(409).json({ error: "Admins and restaurant owners cannot be reassigned as staff" });
        }

        const updated = await prisma.user.update({
            where: { id: staffUser.id },
            data: { role: "EMPLOYEE", staffRestaurantId: req.params.restaurantId },
            select: { id: true, email: true, name: true, role: true, staffRestaurantId: true }
        });

        await auditLog("STAFF_ADDED", { actorUserId: req.user.userId, restaurantId: req.params.restaurantId, targetUserId: updated.id });

        res.status(201).json({ staff: updated });
    } catch (err) {
        logRouteError("POST /admin/staff/:restaurantId", err);
        res.status(500).json({ error: "Error assigning staff" });
    }
});

router.delete("/admin/staff/:restaurantId/:userId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only admins and restaurant owners can manage staff" });
        if (!ensureWorkspaceService(access, res)) return;

        const staffUser = await prisma.user.findUnique({
            where: { id: req.params.userId },
            select: { id: true, role: true, staffRestaurantId: true }
        });

        if (!staffUser || staffUser.staffRestaurantId !== req.params.restaurantId) {
            return res.status(404).json({ error: "Staff member not found for this restaurant" });
        }

        const updated = await prisma.user.update({
            where: { id: staffUser.id },
            data: { staffRestaurantId: null, ...(staffUser.role === "EMPLOYEE" && { role: "USER" }) },
            select: { id: true, email: true, name: true, role: true, staffRestaurantId: true }
        });

        await auditLog("STAFF_REMOVED", { actorUserId: req.user.userId, restaurantId: req.params.restaurantId, targetUserId: updated.id });

        res.json({ staff: updated });
    } catch (err) {
        logRouteError("DELETE /admin/staff/:restaurantId/:userId", err);
        res.status(500).json({ error: "Error removing staff" });
    }
});

// Admin endpoint to record a refund after processing it manually in Razorpay dashboard.
router.patch("/admin/order/:id/payment-status", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can record refunds" });

        const { paymentStatus } = req.body;
        const allowed = ["REFUNDED", "PARTIALLY_REFUNDED"];
        if (!allowed.includes(paymentStatus)) {
            return res.status(400).json({ error: `paymentStatus must be one of: ${allowed.join(", ")}` });
        }

        const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true, paymentStatus: true, restaurantId: true } });
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.paymentStatus !== "PAID") return res.status(409).json({ error: "Refunds can only be recorded for paid orders" });

        const updated = await prisma.order.update({ where: { id: order.id }, data: { paymentStatus } });

        await auditLog("ORDER_STATUS_UPDATED", {
            actorUserId: user.id, restaurantId: order.restaurantId, orderId: order.id,
            metadata: { paymentStatusChange: paymentStatus }
        });

        res.json({ id: updated.id, paymentStatus: updated.paymentStatus });
    } catch (err) {
        logRouteError("PATCH /admin/order/:id/payment-status", err);
        res.status(500).json({ error: "Could not update payment status" });
    }
});

module.exports = router;

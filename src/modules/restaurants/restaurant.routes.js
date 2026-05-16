"use strict";
/**
 * /api/v1 restaurant-management routes.
 *   GET   /restaurant/subscription
 *   PATCH /restaurant/menu/items/:id/availability
 */

const express = require("express");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err } = require("../../lib/response");
const { cleanString, logRouteError } = require("../../lib/helpers");
const { v1Auth } = require("../../middlewares/auth.middleware");
const {
    getAuthUser,
    getRestaurantAccess,
    isRestaurantServiceAvailable,
    auditLog,
} = require("../../services/auth.service");

const prisma = createPrismaClient();
const router = express.Router();

router.patch("/menu/items/:id/availability", v1Auth, async (req, res) => {
    try {
        const item = await prisma.menu.findUnique({
            where: { id: req.params.id },
            select: { id: true, restaurantId: true, isAvailable: true, name: true }
        });
        if (!item) return v1err(res, "NOT_FOUND", "Menu item not found", 404);
        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        const isAvailable = typeof req.body.isAvailable === "boolean" ? req.body.isAvailable : !item.isAvailable;
        const updated = await prisma.menu.update({ where: { id: item.id }, data: { isAvailable } });
        await auditLog("MENU_ITEM_UPDATED", {
            actorUserId: req.user.userId,
            restaurantId: item.restaurantId,
            metadata: { itemId: item.id, itemName: item.name, isAvailable }
        });
        return v1ok(res, { id: updated.id, name: updated.name, isAvailable: updated.isAvailable });
    } catch (err) {
        logRouteError("PATCH /api/v1/restaurant/menu/items/:id/availability", err);
        return v1err(res, "SERVER_ERROR", "Could not update availability", 500);
    }
});

router.get("/subscription", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user || user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant access only", 403);
        let restaurantId = cleanString(req.query.restaurantId, 80);
        if (!restaurantId && user.role === "RESTAURANT_OWNER") {
            const r = await prisma.restaurant.findFirst({ where: { ownerId: user.id }, select: { id: true } });
            restaurantId = r?.id;
        } else if (!restaurantId && user.role === "EMPLOYEE") {
            restaurantId = user.staffRestaurantId;
        }
        if (!restaurantId) return v1err(res, "BAD_REQUEST", "restaurantId required");
        const access = await getRestaurantAccess(restaurantId, user.id);
        if (!access.canAccess) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        return v1ok(res, {
            subscriptionStatus: access.restaurant.subscriptionStatus,
            subscriptionEndsAt: access.restaurant.subscriptionEndsAt,
            isActive: access.restaurant.isActive,
            serviceAvailable: isRestaurantServiceAvailable(access.restaurant)
        });
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/subscription", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch subscription", 500);
    }
});

module.exports = router;

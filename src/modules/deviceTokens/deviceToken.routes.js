"use strict";
/**
 * /api/v1 device-token registration for push notifications.
 *   POST /customer/device-token
 *   POST /restaurant/device-token
 *
 * Device tokens are upserted by token (unique). Active flag and lastSeenAt are refreshed
 * so periodic re-registration keeps the token alive without creating duplicates.
 */

const express = require("express");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err } = require("../../lib/response");
const { logRouteError } = require("../../lib/helpers");
const { v1Auth } = require("../../middlewares/auth.middleware");
const { getAuthUser } = require("../../services/auth.service");

const prisma = createPrismaClient();
const router = express.Router();

const VALID_PLATFORMS = ["ios", "android", "web"];

router.post("/customer/device-token", v1Auth, async (req, res) => {
    try {
        if (req.user.role !== "USER") return v1err(res, "FORBIDDEN", "Customer accounts only", 403);
        const { token, platform, appType } = req.body;
        if (!token || !platform) return v1err(res, "VALIDATION_ERROR", "token and platform required");
        if (!VALID_PLATFORMS.includes(String(platform).toLowerCase())) {
            return v1err(res, "VALIDATION_ERROR", "platform must be ios, android, or web");
        }
        await prisma.deviceToken.upsert({
            where: { token: String(token) },
            update: { isActive: true, lastSeenAt: new Date(), platform: String(platform).toLowerCase(), appType: appType || "customer" },
            create: { userId: req.user.userId, token: String(token), platform: String(platform).toLowerCase(), appType: appType || "customer" }
        });
        return v1ok(res, { registered: true });
    } catch (err) {
        logRouteError("POST /api/v1/customer/device-token", err);
        return v1err(res, "SERVER_ERROR", "Could not register device token", 500);
    }
});

router.post("/restaurant/device-token", v1Auth, async (req, res) => {
    try {
        if (req.user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant/admin accounts only", 403);
        const { token, platform, appType } = req.body;
        if (!token || !platform) return v1err(res, "VALIDATION_ERROR", "token and platform required");
        if (!VALID_PLATFORMS.includes(String(platform).toLowerCase())) {
            return v1err(res, "VALIDATION_ERROR", "platform must be ios, android, or web");
        }
        const user = await getAuthUser(req.user.userId);
        const restaurantId = user?.staffRestaurantId || null;
        await prisma.deviceToken.upsert({
            where: { token: String(token) },
            update: { isActive: true, lastSeenAt: new Date(), platform: String(platform).toLowerCase(), appType: appType || "restaurant" },
            create: { userId: req.user.userId, restaurantId, token: String(token), platform: String(platform).toLowerCase(), appType: appType || "restaurant" }
        });
        return v1ok(res, { registered: true });
    } catch (err) {
        logRouteError("POST /api/v1/restaurant/device-token", err);
        return v1err(res, "SERVER_ERROR", "Could not register device token", 500);
    }
});

module.exports = router;

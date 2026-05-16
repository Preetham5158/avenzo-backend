"use strict";
/**
 * /api/v1 — Mobile-first API surface (Expo React Native customer + restaurant apps).
 *
 * All responses use a consistent {success, data} / {success, error{code,message}} envelope.
 * Old legacy routes continue to work unchanged — this is an additive, parallel surface.
 *
 * Auth: the same JWT tokens work on both web and mobile.
 */

const express = require("express");

const { v1err } = require("../lib/response");

const router = express.Router();

// Set API version header on every /api/v1 response.
router.use((req, res, next) => {
    res.setHeader("X-API-Version", "v1");
    next();
});

// Auth — customer/restaurant login, signup, and `me` endpoints.
router.use("/", require("../modules/auth/auth.routes"));

// Public — anonymous restaurant/menu/payment-method/order-lookup endpoints.
router.use("/public", require("../modules/public/public.routes"));

// Customer + restaurant orders.
router.use("/", require("../modules/orders/order.routes"));

// Customer + restaurant payments.
router.use("/", require("../modules/payments/payment.routes"));

// Restaurant management (subscription, menu availability).
router.use("/restaurant", require("../modules/restaurants/restaurant.routes"));

// Customer + restaurant device tokens for push notifications.
router.use("/", require("../modules/deviceTokens/deviceToken.routes"));

// JSON catch-all for unknown /api/v1 routes — prevents HTML responses.
router.use((req, res) => {
    return v1err(res, "NOT_FOUND", `${req.method} ${req.path} is not a valid API endpoint`, 404);
});

module.exports = router;

"use strict";
/**
 * Centralised Redis-backed rate limiters.
 * Falls back to in-memory Map in dev if Redis is unavailable.
 * Key functions tighten limits by IP + credential/session/tracking-token.
 */

const { createRateLimiter } = require("../middlewares/rateLimit.middleware");
const { cleanString } = require("../lib/helpers");

const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, max: 30, namespace: "auth",
    keyFn: (req) => {
        const cred = cleanString(req.body?.email || req.body?.phone, 60) || "";
        return `${req.ip}:${cred}`;
    }
});

const orderLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 20, namespace: "order",
    keyFn: (req) => `${req.ip}:${cleanString(req.body?.sessionId, 80) || ""}`
});

const orderLookupLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 12, namespace: "olookup"
});

const trackingLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 60, namespace: "track"
});

const restaurantInterestLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, max: 8, namespace: "rint"
});

const otpLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000, max: 12, namespace: "otp",
    keyFn: (req) => {
        const cred = cleanString(req.body?.email || req.body?.phone, 60) || "";
        return `${req.ip}:${cred}`;
    }
});

const passwordResetLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, max: 5, namespace: "pwreset"
});

const paymentLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 15, namespace: "payment",
    keyFn: (req) => `${req.ip}:${cleanString(req.body?.trackingToken, 80) || ""}`
});

module.exports = {
    authLimiter,
    orderLimiter,
    orderLookupLimiter,
    trackingLimiter,
    restaurantInterestLimiter,
    otpLimiter,
    passwordResetLimiter,
    paymentLimiter,
};

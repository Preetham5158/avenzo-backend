"use strict";
/**
 * /api/v1 auth routes (customer + restaurant partner).
 * - POST /customer/auth/signup
 * - POST /customer/auth/login
 * - GET  /customer/auth/me
 * - POST /restaurant/auth/login
 * - GET  /restaurant/me
 * - GET  /me
 */

const express = require("express");
const bcrypt = require("bcrypt");

const { createPrismaClient } = require("../../prisma");
const { v1ok, v1err } = require("../../lib/response");
const { cleanString, isValidEmail, logRouteError } = require("../../lib/helpers");
const { normalizePhone, isValidPhone } = require("../../utils/phone");
const { authLimiter } = require("../../config/rateLimiters");
const { v1Auth } = require("../../middlewares/auth.middleware");
const {
    signAuthToken,
    findPasswordUser,
    getAuthUser,
} = require("../../services/auth.service");

const prisma = createPrismaClient();
const router = express.Router();

router.post("/customer/auth/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        if (!isValidEmail(email)) return v1err(res, "VALIDATION_ERROR", "Valid email required");
        if (!password || String(password).length < 8) return v1err(res, "VALIDATION_ERROR", "Password must be at least 8 characters");

        const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
        if (existing) return v1err(res, "CONFLICT", "An account with this email already exists", 409);

        const normalizedPhone = phone ? normalizePhone(String(phone)) : null;
        if (phone && !normalizedPhone) return v1err(res, "VALIDATION_ERROR", "Invalid phone number");

        const hashed = await bcrypt.hash(String(password), 12);
        const user = await prisma.user.create({
            data: {
                email: String(email).toLowerCase().trim(),
                password: hashed,
                name: cleanString(name, 120) || null,
                phone: normalizedPhone,
                role: "USER"
            },
            select: { id: true, email: true, name: true, phone: true, role: true }
        });

        return v1ok(res, {
            accessToken: signAuthToken(user),
            expiresIn: 7 * 24 * 3600,
            user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role }
        }, 201);
    } catch (err) {
        logRouteError("POST /api/v1/customer/auth/signup", err);
        return v1err(res, "SERVER_ERROR", "Could not create account", 500);
    }
});

router.post("/customer/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return v1err(res, "VALIDATION_ERROR", "Email and password required");
        const user = await findPasswordUser(email, password);
        if (!user) return v1err(res, "INVALID_CREDENTIALS", "Incorrect email or password", 401);
        if (user.role !== "USER") return v1err(res, "FORBIDDEN", "Use the restaurant partner login for this account", 403);
        return v1ok(res, {
            accessToken: signAuthToken(user),
            expiresIn: 7 * 24 * 3600,
            user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role }
        });
    } catch (err) {
        logRouteError("POST /api/v1/customer/auth/login", err);
        return v1err(res, "SERVER_ERROR", "Login failed", 500);
    }
});

router.get("/customer/auth/me", v1Auth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, name: true, phone: true, role: true }
        });
        if (!user) return v1err(res, "NOT_FOUND", "Account not found", 404);
        return v1ok(res, { user });
    } catch (err) {
        logRouteError("GET /api/v1/customer/auth/me", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch profile", 500);
    }
});

router.post("/restaurant/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return v1err(res, "VALIDATION_ERROR", "Email and password required");
        const user = await findPasswordUser(email, password);
        if (!user) return v1err(res, "INVALID_CREDENTIALS", "Incorrect email or password", 401);
        if (user.role === "USER") return v1err(res, "FORBIDDEN", "Use the customer login for this account", 403);

        let restaurant = null;
        if (user.role === "RESTAURANT_OWNER") {
            restaurant = await prisma.restaurant.findFirst({
                where: { ownerId: user.id },
                select: { id: true, name: true, slug: true, isActive: true, subscriptionStatus: true }
            });
        } else if (user.role === "EMPLOYEE" && user.staffRestaurantId) {
            restaurant = await prisma.restaurant.findUnique({
                where: { id: user.staffRestaurantId },
                select: { id: true, name: true, slug: true, isActive: true, subscriptionStatus: true }
            });
        }

        return v1ok(res, {
            accessToken: signAuthToken(user),
            expiresIn: 7 * 24 * 3600,
            user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
            restaurant
        });
    } catch (err) {
        logRouteError("POST /api/v1/restaurant/auth/login", err);
        return v1err(res, "SERVER_ERROR", "Login failed", 500);
    }
});

router.get("/restaurant/me", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user || user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant/admin access only", 403);

        let restaurant = null;
        if (user.role === "RESTAURANT_OWNER") {
            restaurant = await prisma.restaurant.findFirst({
                where: { ownerId: user.id },
                select: { id: true, name: true, slug: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
            });
        } else if (user.role === "EMPLOYEE" && user.staffRestaurantId) {
            restaurant = await prisma.restaurant.findUnique({
                where: { id: user.staffRestaurantId },
                select: { id: true, name: true, slug: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
            });
        }

        return v1ok(res, {
            user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
            restaurant
        });
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/me", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch profile", 500);
    }
});

router.patch("/customer/profile", v1Auth, async (req, res) => {
    try {
        // Customer accounts only — restaurant/admin users have no profile to update here.
        if (req.user.role !== "USER") return v1err(res, "FORBIDDEN", "Customer accounts only", 403);

        const updateData = {};
        if ("name" in req.body) {
            updateData.name = cleanString(req.body.name, 120) || null;
        }
        if ("phone" in req.body) {
            if (req.body.phone === null || req.body.phone === "") {
                updateData.phone = null;
            } else {
                const normalized = normalizePhone(String(req.body.phone));
                if (!normalized || !isValidPhone(normalized)) {
                    return v1err(res, "VALIDATION_ERROR", "Invalid phone number");
                }
                updateData.phone = normalized;
            }
        }
        if (Object.keys(updateData).length === 0) {
            return v1err(res, "VALIDATION_ERROR", "Provide at least one field to update: name or phone");
        }

        const updated = await prisma.user.update({
            where: { id: req.user.userId },
            data: updateData,
            select: { id: true, email: true, name: true, phone: true, role: true }
        });

        return v1ok(res, { user: updated });
    } catch (err) {
        logRouteError("PATCH /api/v1/customer/profile", err);
        return v1err(res, "SERVER_ERROR", "Could not update profile", 500);
    }
});

router.get("/me", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return v1err(res, "NOT_FOUND", "Account not found", 404);
        return v1ok(res, { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role });
    } catch (err) {
        logRouteError("GET /api/v1/me", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch profile", 500);
    }
});

module.exports = router;

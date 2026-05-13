require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { notifyOrderConfirmation, sendOtp } = require("./services/notification.service");
const { checkOrderAbuse, hashIp, logOrderAttempt } = require("./services/abuse.service");
const { publicMenuItem, adminMenuItem } = require("./serializers/menu.serializer");
const { publicOrderResponse, customerOrderSummary } = require("./serializers/order.serializer");
const { submitRating } = require("./services/rating.service");
const { rupeesToPaise, paiseToRupees } = require("./utils/money");
const { publicMenuKey } = require("./utils/token");
const { isValidPhone, normalizePhone } = require("./utils/phone");
const { createPrismaClient } = require("./prisma");

const app = express();
const prisma = createPrismaClient();
const JWT_ISSUER = "avenzo-api";
const JWT_AUDIENCE = "avenzo-admin";
const FOOD_TYPES = ["VEG", "NON_VEG"];
const RESTAURANT_FOOD_TYPES = ["PURE_VEG", "NON_VEG", "BOTH"];
const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "EXPIRED", "SUSPENDED"];
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "CLOSED"];
const ORDER_STATUS_TRANSITIONS = {
    PENDING: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: []
};

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
}

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
});
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

function rateLimit({ windowMs, max }) {
    const hits = new Map();
    let sweepCounter = 0;
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

        if (entry.resetAt < now) {
            entry.count = 0;
            entry.resetAt = now + windowMs;
        }

        entry.count += 1;
        hits.set(key, entry);
        sweepCounter += 1;

        if (sweepCounter % 200 === 0) {
            for (const [mapKey, mapEntry] of hits.entries()) {
                if (mapEntry.resetAt < now) {
                    hits.delete(mapKey);
                }
            }
        }

        if (entry.count > max) {
            return res.status(429).json({ error: "Please wait a moment and try again" });
        }

        next();
    };
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
const orderLookupLimiter = rateLimit({ windowMs: 60 * 1000, max: 12 });
const trackingLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
const restaurantInterestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8 });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 12 });
const OTP_PURPOSES = ["CUSTOMER_LOGIN", "RESTAURANT_LOGIN", "SIGNUP_VERIFY", "ORDER_CONFIRMATION", "PASSWORD_RESET"];

function normalizeSlug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeFoodType(value, fallback = "VEG") {
    const normalized = String(value || fallback).toUpperCase();
    return FOOD_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeRestaurantFoodType(value, fallback = "BOTH") {
    const normalized = String(value || fallback).toUpperCase();
    return RESTAURANT_FOOD_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeSubscriptionStatus(value, fallback = "ACTIVE") {
    const normalized = String(value || fallback).toUpperCase();
    return SUBSCRIPTION_STATUSES.includes(normalized) ? normalized : fallback;
}

function cleanString(value, maxLength = 500) {
    if (typeof value === "undefined" || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned ? cleaned.slice(0, maxLength) : null;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function menuFoodFilter(value) {
    if (!value || String(value).toUpperCase() === "ALL") return {};
    const foodType = String(value).toUpperCase();
    return FOOD_TYPES.includes(foodType) ? { foodType } : {};
}

function allowedNextOrderStatuses(status) {
    return ORDER_STATUS_TRANSITIONS[status] || [];
}

function restaurantFoodTypeAllowsItem(restaurantFoodType, itemFoodType) {
    if (restaurantFoodType === "PURE_VEG") return itemFoodType === "VEG";
    if (restaurantFoodType === "NON_VEG") return itemFoodType === "NON_VEG";
    return true;
}

function incompatibleFoodTypeMessage(restaurantFoodType) {
    if (restaurantFoodType === "PURE_VEG") return "Pure veg restaurants can only add veg items";
    if (restaurantFoodType === "NON_VEG") return "Non-veg restaurants can only add non-veg items";
    return "This item food type is not allowed for the restaurant";
}

function logRouteError(route, err) {
    const message = err?.message || String(err);
    const code = err?.code ? ` code=${err.code}` : "";
    console.error(`[${route}]${code} ${message}`);
}

async function auditLog(action, data = {}) {
    try {
        await prisma.auditLog.create({
            data: {
                action,
                actorUserId: data.actorUserId || null,
                restaurantId: data.restaurantId || null,
                orderId: data.orderId || null,
                targetUserId: data.targetUserId || null,
                metadata: data.metadata || undefined
            }
        });
    } catch (err) {
        console.error(`[audit:failed] ${err?.message || err}`);
    }
}

function restaurant2faRequired() {
    return String(process.env.AUTH_REQUIRE_RESTAURANT_2FA || "true").toLowerCase() === "true";
}

function customer2faRequired() {
    return String(process.env.AUTH_REQUIRE_CUSTOMER_2FA || "false").toLowerCase() === "true";
}

function otpTtlMinutes() {
    return Math.max(parseInt(process.env.OTP_TTL_MINUTES || "10", 10), 1);
}

function otpMaxAttempts() {
    return Math.min(Math.max(parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10), 1), 10);
}

function generateOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function hashOtp(value) {
    return bcrypt.hash(String(value), 10);
}

async function createOtpChallenge(user, purpose) {
    const otp = generateOtp();
    const channel = user.phone ? "SMS" : user.email ? "EMAIL" : "LOG";
    const challenge = await prisma.otpChallenge.create({
        data: {
            userId: user.id,
            email: user.email || null,
            phone: user.phone || null,
            purpose,
            channel: process.env.OTP_MODE === "log" ? "LOG" : channel,
            otpHash: await hashOtp(otp),
            expiresAt: new Date(Date.now() + otpTtlMinutes() * 60 * 1000),
            maxAttempts: otpMaxAttempts(),
            metadata: { role: user.role }
        },
        select: { id: true, expiresAt: true, channel: true }
    });

    await sendOtp({
        prisma,
        userId: user.id,
        channel,
        phone: user.phone,
        email: user.email,
        purpose,
        otp
    });

    return challenge;
}

function signAuthToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d",
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        }
    );
}

function authUserResponse(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role
    };
}

function loginSuccessResponse(user) {
    return {
        token: signAuthToken(user),
        user: authUserResponse(user)
    };
}

async function findPasswordUser(email, password) {
    if (!email || !password) return null;
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
}

async function ensureFoodTypeSchema() {
    await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
            CREATE TYPE "FoodType" AS ENUM ('VEG', 'NON_VEG');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
    `);

    await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
            CREATE TYPE "RestaurantFoodType" AS ENUM ('PURE_VEG', 'NON_VEG', 'BOTH');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE "Restaurant"
        ADD COLUMN IF NOT EXISTS "foodType" "RestaurantFoodType" NOT NULL DEFAULT 'BOTH';
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE "Menu"
        ADD COLUMN IF NOT EXISTS "foodType" "FoodType" NOT NULL DEFAULT 'VEG';
    `);
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/r/:slug", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/menu.html"));
});

app.get("/restaurant/slug/:slug", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug: req.params.slug },
        });

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

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

app.get("/restaurant/:id", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: req.params.id },
        });

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        res.json(publicRestaurantResponse(restaurant));
    } catch (err) {
        logRouteError("GET /restaurant/:id", err);
        res.status(500).json({ error: "Error fetching restaurant" });
    }
});
app.get("/menu/:restaurantId", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId } });
        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
        if (!isRestaurantServiceAvailable(restaurant)) {
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        const menu = await prisma.menu.findMany({
            where: {
                restaurantId: req.params.restaurantId,
                isActive: true,
                ...menuFoodFilter(req.query.foodType)
            },
            include: { category: true },
            orderBy: [
                { isAvailable: "desc" },
                { category: { name: "asc" } }
            ]
        });

        res.json(menu.map(publicMenuItem));
    } catch (err) {
        logRouteError("GET /menu/:restaurantId", err);
        res.status(500).json({ error: "Error fetching menu" });
    }
});

app.get("/menu/by-slug/:slug", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug: req.params.slug },
        });

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        if (!isRestaurantServiceAvailable(restaurant)) {
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        const menu = await prisma.menu.findMany({
            where: { restaurantId: restaurant.id, isActive: true, ...menuFoodFilter(req.query.foodType) },
            include: { category: true },
            orderBy: [
                { isAvailable: "desc" },
                { category: { sortOrder: "asc" } },
                { name: "asc" }
            ]
        });

        res.json(menu.map(publicMenuItem));
    } catch (err) {
        logRouteError("GET /menu/by-slug/:slug", err);
        res.status(500).json({ error: "Error fetching menu" });
    }
});

app.get("/categories/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const categories = await prisma.category.findMany({
            where: { restaurantId: req.params.restaurantId },
            orderBy: [
                { sortOrder: "asc" },
                { name: "asc" }
            ]
        });

        res.json(categories);
    } catch (err) {
        logRouteError("GET /categories/:restaurantId", err);
        res.status(500).json({ error: "Error fetching categories" });
    }
});

app.post("/order", orderLimiter, optionalAuth, async (req, res) => {
    try {
        const { items, sessionId, phone } = req.body;
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

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }
        restaurantId = restaurant.id;

        if (!isRestaurantServiceAvailable(restaurant)) {
            await logOrderAttempt(prisma, {
                restaurantId,
                phone: normalizePhone(phone),
                deviceId,
                ipHash,
                status: "REJECTED",
                reason: "restaurant_unavailable"
            });
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        let customer = null;
        if (!guestOrder && req.user?.userId) {
            customer = await prisma.user.findUnique({
                where: { id: req.user.userId },
                select: { id: true, email: true, role: true, phone: true }
            });
            if (!customer) {
                return res.status(401).json({ error: "Invalid customer account" });
            }
            if (customer.role !== "USER") {
                return res.status(403).json({ error: "Use a customer account to place customer orders" });
            }
        }

        // Guest orders stay separate from accounts until a future verified claim flow exists.
        let normalizedPhone = normalizePhone(phone);
        const shouldSaveCustomerPhone = !!customer && !customer.phone && !!normalizedPhone;
        if (!normalizedPhone && customer?.phone) {
            normalizedPhone = normalizePhone(customer.phone);
        }

        if (!normalizedPhone) {
            await logOrderAttempt(prisma, {
                restaurantId,
                phone: null,
                deviceId,
                ipHash,
                status: "REJECTED",
                reason: "missing_phone"
            });
            return res.status(400).json({ error: "Mobile number is required to place an order" });
        }

        if (!isValidPhone(normalizedPhone)) {
            await logOrderAttempt(prisma, {
                restaurantId,
                phone: normalizedPhone,
                deviceId,
                ipHash,
                status: "REJECTED",
                reason: "invalid_phone"
            });
            return res.status(400).json({ error: "Invalid phone number" });
        }

        const abuse = await checkOrderAbuse(prisma, {
            restaurantId,
            phone: normalizedPhone,
            deviceId,
            ipHash
        });

        if (!abuse.allowed) {
            await auditLog("ORDER_ATTEMPT_REJECTED", {
                restaurantId,
                metadata: { reason: abuse.reason }
            });
            return res.status(429).json({ error: abuse.reason });
        }

        const pickupCode = crypto.randomInt(1000, 10000).toString();
        const trackingToken = crypto.randomUUID();

        const hasPublicMenuKeys = normalizedItems.some(i => i.menuKey);
        const menuItems = await prisma.menu.findMany({
            where: hasPublicMenuKeys
                ? { restaurantId, isActive: true }
                : {
                      id: { in: normalizedItems.map(i => i.menuId) },
                      restaurantId,
                      isActive: true
                  }
        });

        let totalPricePaise = 0;

        normalizedItems.forEach(i => {
            const menu = menuItems.find(m =>
                i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey
            );

            if (!menu) {
                throw new Error("Invalid item");
            }

            if (!menu.isAvailable) {
                throw new Error(`${menu.name} is unavailable`);
            }

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
                    paymentStatus: "PAYMENT_NOT_REQUIRED",
                    pickupCode,
                    trackingToken,
                    sessionId: deviceId,
                    phone: normalizedPhone,
                    // Signed-in customer orders attach customerId so they appear in My Orders.
                    ...(customer && { customerId: customer.id }),
                    restaurantId,
                    items: {
                        create: normalizedItems.map(i => {
                            const menu = menuItems.find(m =>
                                i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey
                            );

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

        await logOrderAttempt(prisma, {
            restaurantId,
            phone: normalizedPhone,
            deviceId,
            ipHash,
            status: "ACCEPTED",
            reason: "order_created"
        });

        if (shouldSaveCustomerPhone) {
            prisma.user.update({
                where: { id: customer.id },
                data: { phone: normalizedPhone }
            }).catch((err) => logRouteError("saveCustomerPhoneAfterOrder", err));
        }

        notifyOrderConfirmation({
            prisma,
            order,
            restaurant,
            baseUrl: BASE_URL,
            recipientEmail: customer?.email
        }).catch((err) => logRouteError("notifyOrderConfirmation", err));

        res.json({
            trackingToken: order.trackingToken,
            orderNumber: order.orderNumber,
            pickupCode,
            paymentStatus: order.paymentStatus,
            message: "Order placed. We will send confirmation updates when available.",
            trackingUrl: `${BASE_URL}/track/${order.trackingToken}`
        });
    } catch (err) {
        logRouteError("POST /order", err);
        const knownOrderError =
            err.message === "Invalid item" ||
            String(err.message || "").endsWith(" is unavailable");
        res.status(knownOrderError ? 400 : 500).json({
            error: knownOrderError ? err.message : "We could not place the order. Please try again."
        });
    }
});

app.get("/order/:trackingToken", trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            include: {
                items: true,
                restaurant: true,
                rating: true
            }
        });

        if (!order) return res.status(404).json({ error: "Not found" });

        res.json(publicOrderResponse(order));
    } catch (err) {
        logRouteError("GET /order/:trackingToken", err);
        res.status(500).json({ error: "Error fetching order" });
    }
});

app.get("/orders/lookup", orderLookupLimiter, async (req, res) => {
    try {
        let restaurantId = cleanString(req.query.restaurantId, 80);
        const restaurantSlug = cleanString(req.query.restaurantSlug, 140);
        const phone = normalizePhone(req.query.phone);

        if ((!restaurantId && !restaurantSlug) || !phone || !isValidPhone(phone)) {
            return res.status(400).json({ error: "Enter the same mobile number used for ordering" });
        }

        if (!restaurantId && restaurantSlug) {
            const restaurant = await prisma.restaurant.findUnique({
                where: { slug: restaurantSlug },
                select: { id: true }
            });
            if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
            restaurantId = restaurant.id;
        }

        const orders = await prisma.order.findMany({
            where: { restaurantId, phone },
            select: {
                trackingToken: true,
                orderNumber: true,
                pickupCode: true,
                status: true,
                totalPricePaise: true,
                createdAt: true
            },
            orderBy: { createdAt: "desc" },
            take: 5
        });

        res.json({
            orders: orders.map((order) => {
                const { totalPricePaise, ...safeOrder } = order;

                return {
                    ...safeOrder,
                    totalPrice: paiseToRupees(totalPricePaise)
                };
            })
        });
    } catch (err) {
        logRouteError("GET /orders/lookup", err);
        res.status(500).json({ error: "Error finding orders" });
    }
});

app.get("/track", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/track.html"));
});

app.get("/track/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/track.html"));
});

app.get("/restaurant-interest", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/restaurant-interest.html"));
});

app.post("/restaurant-interest", restaurantInterestLimiter, async (req, res) => {
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

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: "Use a valid email address" });
        }

        if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) {
            return res.status(400).json({ error: "Use a valid phone number" });
        }

        await prisma.restaurantLead.create({
            data: {
                restaurantName,
                contactName,
                phone,
                email: email.toLowerCase(),
                location,
                restaurantType,
                approxDailyOrders,
                message
            }
        });

        res.status(201).json({
            message: "Thanks for your interest. The Avenzo team will get back to you soon."
        });
    } catch (err) {
        logRouteError("POST /restaurant-interest", err);
        res.status(500).json({ error: "Could not save your interest right now" });
    }
});

app.post("/auth/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "Use a valid email and at least 8 characters for password" });
        }

        const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
        if (existing) {
            return res.status(400).json({ error: "User already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        await prisma.user.create({
            data: { email: String(email).toLowerCase().trim(), password: hashed, name }
        });

        res.json({ message: "Customer account created" });

    } catch (err) {
        logRouteError("POST /auth/signup", err);
        res.status(500).json({ error: "Signup failed" });
    }
});

app.post("/auth/customer/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;

        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "Use a valid email and at least 8 characters for password" });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const normalizedPhone = phone ? normalizePhone(phone) : null;
        if (normalizedPhone && !isValidPhone(normalizedPhone)) {
            return res.status(400).json({ error: "Use a valid phone number" });
        }

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return res.status(400).json({ error: "User already exists" });
        }

        await prisma.user.create({
            data: {
                email: normalizedEmail,
                password: await bcrypt.hash(password, 10),
                name: cleanString(name, 120),
                phone: normalizedPhone
            }
        });

        res.json({ message: "Customer account created" });
    } catch (err) {
        logRouteError("POST /auth/customer/signup", err);
        res.status(500).json({ error: "Signup failed" });
    }
});

app.post("/auth/customer/login", authLimiter, async (req, res) => {
    try {
        const user = await findPasswordUser(req.body.email, req.body.password);
        if (!user) return res.status(400).json({ error: "Invalid credentials" });
        if (user.role !== "USER") {
            return res.status(403).json({ error: "This sign in is for customer accounts. Restaurant partners should use restaurant login." });
        }

        if (customer2faRequired()) {
            const challenge = await createOtpChallenge(user, "CUSTOMER_LOGIN");
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                expiresAt: challenge.expiresAt
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/customer/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

app.post("/auth/restaurant/login", authLimiter, async (req, res) => {
    try {
        const user = await findPasswordUser(req.body.email, req.body.password);
        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        // Restaurant partner login is only for approved admin, owner, and employee accounts.
        if (user.role === "USER") {
            return res.status(403).json({ error: "This is a customer account. Restaurant access is available only for approved Avenzo partners." });
        }

        if (restaurant2faRequired()) {
            const challenge = await createOtpChallenge(user, "RESTAURANT_LOGIN");
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                expiresAt: challenge.expiresAt
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/restaurant/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

app.post("/auth/otp/verify", otpLimiter, async (req, res) => {
    try {
        const { challengeId, otp, purpose } = req.body;
        if (!challengeId || !otp) return res.status(400).json({ error: "OTP required" });

        const challenge = await prisma.otpChallenge.findUnique({
            where: { id: String(challengeId) },
            include: { user: true }
        });

        if (!challenge || !challenge.user) return res.status(400).json({ error: "Invalid or expired OTP" });
        if (purpose && challenge.purpose !== purpose) return res.status(400).json({ error: "Invalid or expired OTP" });
        if (challenge.consumedAt) return res.status(400).json({ error: "OTP already used" });
        if (challenge.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
        if (challenge.attempts >= challenge.maxAttempts) return res.status(429).json({ error: "Too many OTP attempts" });

        const valid = await bcrypt.compare(String(otp), challenge.otpHash);
        if (!valid) {
            await prisma.otpChallenge.update({
                where: { id: challenge.id },
                data: { attempts: { increment: 1 } }
            });
            return res.status(400).json({ error: "Invalid OTP" });
        }

        await prisma.otpChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: new Date() }
        });

        res.json(loginSuccessResponse(challenge.user));
    } catch (err) {
        logRouteError("POST /auth/otp/verify", err);
        res.status(500).json({ error: "OTP verification failed" });
    }
});

app.post("/auth/otp/resend", otpLimiter, async (req, res) => {
    try {
        const { challengeId } = req.body;
        if (!challengeId) return res.status(400).json({ error: "Challenge required" });

        const current = await prisma.otpChallenge.findUnique({
            where: { id: String(challengeId) },
            include: { user: true }
        });

        if (!current || !current.user || current.consumedAt) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        await prisma.otpChallenge.update({
            where: { id: current.id },
            data: { consumedAt: new Date() }
        });

        const challenge = await createOtpChallenge(current.user, current.purpose);
        res.json({
            otpRequired: true,
            challengeId: challenge.id,
            channel: challenge.channel,
            expiresAt: challenge.expiresAt
        });
    } catch (err) {
        logRouteError("POST /auth/otp/resend", err);
        res.status(500).json({ error: "Could not resend OTP" });
    }
});

app.post("/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email & password required" });
        }

        const user = await findPasswordUser(email, password);
        if (!user) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        res.json(loginSuccessResponse(user));

    } catch (err) {
        logRouteError("POST /auth/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) return res.status(401).json({ error: "Please sign in again." });

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });
        req.user = decoded;
        next();
    } catch {
        res.status(401).json({ error: "Please sign in again." });
    }
}

function optionalAuth(req, res, next) {
    if (req.body?.guest === true) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });
    } catch {
        return res.status(401).json({ error: "Please sign in again." });
    }

    next();
}

app.get("/auth/me", authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, name: true, phone: true, role: true }
        });

        res.json(user);
    } catch (err) {
        logRouteError("GET /auth/me", err);
        res.status(500).json({ error: "Error fetching account" });
    }
});

app.get("/customer/profile", authMiddleware, async (req, res) => {
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

app.patch("/customer/profile", authMiddleware, async (req, res) => {
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

app.get("/customer/restaurants", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return res.status(401).json({ error: "Invalid user" });
        if (user.role !== "USER") return res.status(403).json({ error: "Customer restaurant discovery is available only for customer accounts" });

        const [restaurants, ratingAgg] = await Promise.all([
            prisma.restaurant.findMany({
                where: { isActive: true },
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

app.get("/customer/orders", authMiddleware, async (req, res) => {
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
                    restaurant: {
                        select: { name: true, slug: true, locality: true, address: true }
                    },
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
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        logRouteError("GET /customer/orders", err);
        res.status(500).json({ error: "Error fetching customer orders" });
    }
});

async function getAuthUser(userId) {
    return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, staffRestaurantId: true }
    });
}

function isSuperAdmin(user) {
    return user?.role === "ADMIN";
}

function isOwner(user) {
    return user?.role === "RESTAURANT_OWNER";
}

function isEmployee(user) {
    return user?.role === "EMPLOYEE";
}

function isSubscriptionExpired(restaurant) {
    return !!restaurant?.subscriptionEndsAt && new Date(restaurant.subscriptionEndsAt) < new Date();
}

function isRestaurantServiceAvailable(restaurant) {
    return (
        !!restaurant?.isActive &&
        !["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus) &&
        !isSubscriptionExpired(restaurant)
    );
}

function restaurantServiceMessage(restaurant) {
    if (!restaurant?.isActive) {
        return "This restaurant is taking a short pause on Avenzo. Please check back soon for faster ordering and smoother dine-in service.";
    }

    if (["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus) || isSubscriptionExpired(restaurant)) {
        return "Ordering is paused for this restaurant right now. Avenzo helps busy restaurants serve guests faster, and service can resume as soon as the restaurant is active again.";
    }

    return "";
}

function publicRestaurantResponse(restaurant) {
    if (!restaurant) return null;

    return {
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        locality: restaurant.locality,
        pickupNote: restaurant.pickupNote,
        foodType: restaurant.foodType,
        isActive: restaurant.isActive,
        serviceAvailable: isRestaurantServiceAvailable(restaurant),
        serviceMessage: restaurantServiceMessage(restaurant)
    };
}

function customerRestaurantResponse(restaurant) {
    if (!restaurant) return null;

    return {
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        locality: restaurant.locality,
        foodType: restaurant.foodType,
        serviceAvailable: isRestaurantServiceAvailable(restaurant),
        serviceMessage: restaurantServiceMessage(restaurant)
    };
}

function getUserPermissions(user) {
    if (!user) {
        return {
            canCreateRestaurant: false,
            canEditRestaurants: false,
            canManageMenuDetails: false,
            canToggleStock: false,
            canUpdateOrders: false
        };
    }

    const superAdmin = isSuperAdmin(user);
    const owner = isOwner(user);
    const employee = isEmployee(user);

    return {
        canCreateRestaurant: superAdmin,
        canEditRestaurants: superAdmin,
        canManageMenuDetails: superAdmin || owner,
        canToggleStock: superAdmin || owner || employee,
        canUpdateOrders: superAdmin || owner || employee
    };
}

async function getRestaurantAccess(restaurantId, userId) {
    const user = await getAuthUser(userId);
    if (!user) return { user: null, restaurant: null, canAccess: false, canManage: false, canOperate: false };

    const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: {
            id: true,
            ownerId: true,
            isActive: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true
        }
    });

    const superAdmin = isSuperAdmin(user);
    const owner = restaurant?.ownerId === user.id && isOwner(user);
    const employee = user.staffRestaurantId === restaurantId && isEmployee(user);

    return {
        user,
        restaurant,
        canAccess: !!restaurant && (superAdmin || owner || employee),
        canManage: !!restaurant && (superAdmin || owner),
        canOperate: !!restaurant && (superAdmin || owner || employee),
        isSuperAdmin: superAdmin,
        isOwner: owner,
        isEmployee: employee
    };
}

function ensureWorkspaceService(access, res) {
    // Super admins can inspect and repair paused or expired restaurants; operators are blocked.
    if (access.isSuperAdmin) return true;
    if (isRestaurantServiceAvailable(access.restaurant)) return true;
    res.status(423).json({ error: restaurantServiceMessage(access.restaurant) });
    return false;
}

app.get("/restaurants", authMiddleware, async (req, res) => {
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
            include: {
                owner: { select: { id: true, email: true, name: true } }
            },
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

app.post("/restaurant", authMiddleware, async (req, res) => {
    try {
        const { name, address, locality, pickupNote, ownerEmail, subscriptionStatus, subscriptionEndsAt, isActive, foodType } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Name required" });
        }

        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) {
            return res.status(403).json({ error: "Only super admins can create restaurants" });
        }

        const slug = normalizeSlug(name);
        let owner = user;
        if (ownerEmail) {
            const ownerRecord = await prisma.user.findUnique({
                where: { email: String(ownerEmail).toLowerCase().trim() }
            });
            if (!ownerRecord) {
                return res.status(400).json({ error: "Owner email must belong to an existing account" });
            }
            owner = await prisma.user.update({
                where: { id: ownerRecord.id },
                data: { role: "RESTAURANT_OWNER" }
            });
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

app.put("/restaurant/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, locality, pickupNote, ownerEmail, isActive, subscriptionStatus, subscriptionEndsAt, foodType } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Name required" });
        }
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) {
            return res.status(403).json({ error: "Only the Avenzo admin team can edit restaurant details" });
        }

        let ownerId;
        if (ownerEmail) {
            const ownerRecord = await prisma.user.findUnique({
                where: { email: String(ownerEmail).toLowerCase().trim() }
            });
            if (!ownerRecord) {
                return res.status(400).json({ error: "Owner email must belong to an existing account" });
            }
            const owner = await prisma.user.update({
                where: { id: ownerRecord.id },
                data: { role: "RESTAURANT_OWNER" }
            });
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
                metadata: {
                    subscriptionStatus: updated.subscriptionStatus,
                    subscriptionEndsAt: updated.subscriptionEndsAt
                }
            }
        );

        res.json(updated);
    } catch (err) {
        logRouteError("PUT /restaurant/:id", err);
        res.status(500).json({ error: "Error updating restaurant" });
    }
});

app.delete("/restaurant/:id", authMiddleware, async (req, res) => {
    res.status(405).json({ error: "Restaurants are deactivated instead of deleted" });
});

app.post("/category", authMiddleware, async (req, res) => {
    try {
        const { name, restaurantId, sortOrder } = req.body;

        if (!name || !restaurantId) {
            return res.status(400).json({ error: "Missing fields" });
        }

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can manage menu categories" });
        if (!ensureWorkspaceService(access, res)) return;

        const category = await prisma.category.upsert({
            where: {
                restaurantId_name: {
                    restaurantId,
                    name: name.trim()
                }
            },
            update: {
                ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) })
            },
            create: {
                name: name.trim(),
                restaurantId,
                ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) })
            }
        });

        res.json(category);
    } catch (err) {
        logRouteError("POST /category", err);
        res.status(500).json({ error: "Error saving category" });
    }
});

app.post("/menu", authMiddleware, async (req, res) => {
    try {
        const { name, price, categoryId, restaurantId, description, imageUrl, foodType } = req.body;
const pricePaise = rupeesToPaise(price);
        if (!name || pricePaise === null || !categoryId || !restaurantId) {
            return res.status(400).json({ error: "Missing or invalid fields" });
        }

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can add menu items" });
        if (!ensureWorkspaceService(access, res)) return;

        const category = await prisma.category.findFirst({
            where: { id: categoryId, restaurantId },
            select: { id: true }
        });

        if (!category) {
            return res.status(400).json({ error: "Invalid category" });
        }

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { foodType: true }
        });
        const normalizedFoodType = normalizeFoodType(foodType);
        if (!restaurantFoodTypeAllowsItem(restaurant?.foodType, normalizedFoodType)) {
            return res.status(400).json({ error: incompatibleFoodTypeMessage(restaurant?.foodType) });
        }

        const item = await prisma.menu.create({
            data: {
                name,
                pricePaise,
                categoryId,
                restaurantId,
                foodType: normalizedFoodType,
                description: description || null,
                imageUrl: imageUrl || null
            },
            include: { category: true }
        });

        res.json(publicMenuItem(item));
    } catch (err) {
        logRouteError("POST /menu", err);
        res.status(500).json({ error: "Error saving menu item" });
    }
});

app.put("/menu/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, categoryId, isAvailable, isActive, description, imageUrl, foodType } = req.body;
const pricePaise = typeof price !== "undefined" ? rupeesToPaise(price) : undefined;
	if (typeof price !== "undefined" && pricePaise === null) {
    return res.status(400).json({ error: "Invalid price" });
}

        const item = await prisma.menu.findUnique({
            where: { id },
            select: { restaurantId: true }
        });

        if (!item) return res.status(404).json({ error: "Not found" });

        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const requestedKeys = Object.keys(req.body);
        if (access.isEmployee) {
            const onlyStock = requestedKeys.length === 1 && typeof isAvailable === "boolean";
            if (!onlyStock) {
                return res.status(403).json({ error: "Team members can only update stock availability" });
            }
        } else if (!access.canManage) {
            return res.status(403).json({ error: "Only owners can edit menu details" });
        }

        if (categoryId) {
            const category = await prisma.category.findFirst({
                where: { id: categoryId, restaurantId: item.restaurantId },
                select: { id: true }
            });

            if (!category) {
                return res.status(400).json({ error: "Invalid category" });
            }
        }

        let normalizedFoodType;
        if (typeof foodType !== "undefined") {
            normalizedFoodType = normalizeFoodType(foodType);
            const restaurant = await prisma.restaurant.findUnique({
                where: { id: item.restaurantId },
                select: { foodType: true }
            });
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

app.patch("/order/:id/status", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            select: { id: true, restaurantId: true, readyAt: true, status: true }
        });

        if (!order) return res.status(404).json({ error: "Not found" });

        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        if (order.status === status) {
            return res.json(order);
        }

        const allowed = allowedNextOrderStatuses(order.status);
        if (!allowed.includes(status)) {
            return res.status(409).json({
                error: `Cannot change order from ${order.status} to ${status}`,
                allowedStatuses: allowed
            });
        }

        const data = { status };
        if (status === "READY" && !order.readyAt) {
            data.readyAt = new Date();
        }

        const updated = await prisma.order.update({
            where: { id },
            data
        });

        await auditLog("ORDER_STATUS_UPDATED", {
            actorUserId: req.user.userId,
            restaurantId: order.restaurantId,
            orderId: order.id,
            metadata: { from: order.status, to: status }
        });

        res.json(updated);
    } catch (err) {
        logRouteError("PATCH /order/:id/status", err);
        res.status(500).json({ error: "Error updating order status" });
    }
});

app.get("/admin/menu/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const menu = await prisma.menu.findMany({
            where: { restaurantId },
            include: { category: true },
            orderBy: [
                { category: { sortOrder: "asc" } },
                { createdAt: "desc" }
            ]
        });

        res.json(menu.map(adminMenuItem));
    } catch (err) {
        logRouteError("GET /admin/menu/:restaurantId", err);
        res.status(500).json({ error: "Error fetching admin menu" });
    }
});

app.get("/admin/orders/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: {
                id: true,
                name: true,
                address: true,
                locality: true,
                pickupNote: true,
                foodType: true,
                isActive: true,
                subscriptionStatus: true,
                subscriptionEndsAt: true
            }
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

        const where = {
            restaurantId,
            ...(requestedStatus && { status: requestedStatus })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: { items: true },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            restaurant,
            orders: orders.map((order) => publicOrderResponse(order, { includeInternalId: true })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        logRouteError("GET /admin/orders/:restaurantId", err);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

app.get("/admin/restaurant-leads", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) {
            return res.status(403).json({ error: "Only admins can view restaurant leads" });
        }

        const status = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (status && !LEAD_STATUSES.includes(status)) {
            return res.status(400).json({ error: "Invalid lead status" });
        }

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
            prisma.restaurantLead.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.restaurantLead.count({ where }),
            prisma.restaurantLead.groupBy({
                by: ["status"],
                _count: { status: true }
            }),
            prisma.restaurantLead.count({
                where: { status: "NEW", viewedAt: null }
            })
        ]);

        res.json({
            leads,
            counts: statusCounts.reduce((acc, item) => {
                acc[item.status] = item._count.status;
                return acc;
            }, {}),
            unseenNewCount,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        logRouteError("GET /admin/restaurant-leads", err);
        res.status(500).json({ error: "Error fetching restaurant leads" });
    }
});

app.get("/admin/restaurant-leads/summary", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can view restaurant leads" });

        const [statusCounts, unseenNewCount] = await Promise.all([
            prisma.restaurantLead.groupBy({ by: ["status"], _count: { status: true } }),
            prisma.restaurantLead.count({ where: { status: "NEW", viewedAt: null } })
        ]);

        res.json({
            counts: statusCounts.reduce((acc, item) => {
                acc[item.status] = item._count.status;
                return acc;
            }, {}),
            unseenNewCount
        });
    } catch (err) {
        logRouteError("GET /admin/restaurant-leads/summary", err);
        res.status(500).json({ error: "Error fetching lead summary" });
    }
});

app.post("/admin/restaurant-leads/mark-seen", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) return res.status(403).json({ error: "Only admins can update restaurant leads" });

        await prisma.restaurantLead.updateMany({
            where: { status: "NEW", viewedAt: null },
            data: { viewedAt: new Date() }
        });

        res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /admin/restaurant-leads/mark-seen", err);
        res.status(500).json({ error: "Error updating leads" });
    }
});

app.patch("/admin/restaurant-leads/:id", authMiddleware, async (req, res) => {
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

        const lead = await prisma.restaurantLead.update({
            where: { id: req.params.id },
            data
        });

        res.json({ lead });
    } catch (err) {
        logRouteError("PATCH /admin/restaurant-leads/:id", err);
        res.status(500).json({ error: "Error updating lead" });
    }
});

app.get("/admin/staff/:restaurantId", authMiddleware, async (req, res) => {
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

app.post("/admin/staff/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only admins and restaurant owners can manage staff" });
        if (!ensureWorkspaceService(access, res)) return;

        const email = cleanString(req.body.email, 180);
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: "Use an existing employee email address" });
        }

        const staffUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });

        if (!staffUser) {
            return res.status(404).json({ error: "That user account does not exist yet" });
        }

        if (["ADMIN", "RESTAURANT_OWNER"].includes(staffUser.role)) {
            return res.status(409).json({ error: "Admins and restaurant owners cannot be reassigned as staff" });
        }

        const updated = await prisma.user.update({
            where: { id: staffUser.id },
            data: {
                role: "EMPLOYEE",
                staffRestaurantId: req.params.restaurantId
            },
            select: { id: true, email: true, name: true, role: true, staffRestaurantId: true }
        });

        await auditLog("STAFF_ADDED", {
            actorUserId: req.user.userId,
            restaurantId: req.params.restaurantId,
            targetUserId: updated.id
        });

        res.status(201).json({ staff: updated });
    } catch (err) {
        logRouteError("POST /admin/staff/:restaurantId", err);
        res.status(500).json({ error: "Error assigning staff" });
    }
});

app.delete("/admin/staff/:restaurantId/:userId", authMiddleware, async (req, res) => {
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
            data: {
                staffRestaurantId: null,
                ...(staffUser.role === "EMPLOYEE" && { role: "USER" })
            },
            select: { id: true, email: true, name: true, role: true, staffRestaurantId: true }
        });

        await auditLog("STAFF_REMOVED", {
            actorUserId: req.user.userId,
            restaurantId: req.params.restaurantId,
            targetUserId: updated.id
        });

        res.json({ staff: updated });
    } catch (err) {
        logRouteError("DELETE /admin/staff/:restaurantId/:userId", err);
        res.status(500).json({ error: "Error removing staff" });
    }
});

// One rating per completed order; guests use trackingToken, customers also verified by userId.
app.post("/order/:trackingToken/rating", orderLimiter, optionalAuth, async (req, res) => {
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

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        if (process.env.ENABLE_BOOTSTRAP_SCHEMA === "true") {
            await ensureFoodTypeSchema();
        }

        app.listen(PORT, () => {
            console.log("Server running on port " + PORT);
        });
    } catch (err) {
        logRouteError("BOOT", err);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    startServer
};

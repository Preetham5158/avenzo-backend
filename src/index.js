require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { randomUUID } = require("crypto");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { connectRedis, disconnectRedis, getRedisClient, isRedisConnected } = require("./lib/redis");
const { createRateLimiter } = require("./middlewares/rateLimit.middleware");
const { notifyOrderConfirmation, notifyOrderStatus, sendOtp, maskEmail } = require("./services/notification.service");
const { checkOrderAbuse, hashIp, logOrderAttempt } = require("./services/abuse.service");
const { publicMenuItem, adminMenuItem } = require("./serializers/menu.serializer");
const { publicOrderResponse, customerOrderSummary } = require("./serializers/order.serializer");
const { submitRating } = require("./services/rating.service");
const { rupeesToPaise, paiseToRupees } = require("./utils/money");
const { publicMenuKey } = require("./utils/token");
const { isValidPhone, normalizePhone } = require("./utils/phone");
const { createPrismaClient } = require("./prisma");

const Razorpay = require("razorpay");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const prisma = createPrismaClient();
const publicDir = path.join(__dirname, "../public");

app.set("trust proxy", 1);

function getRazorpayInstance() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay credentials not configured");
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getEnabledPaymentMethods(restaurantId) {
    return prisma.paymentMethod.findMany({
        where: { restaurantId, isEnabled: true },
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
    });
}
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

// CORS — must be registered before all routes so OPTIONS preflight is handled correctly.
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5000,http://localhost:3000")
    .split(",").map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin requests (no Origin header) and listed origins.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID"],
}));

// Request ID — attach before any route so it's available in error handlers and logs.
app.use((req, res, next) => {
    const id = req.headers["x-request-id"] || randomUUID();
    req.requestId = id;
    req._startAt = process.hrtime();
    res.setHeader("X-Request-ID", id);
    res.on("finish", () => {
        const diff = process.hrtime(req._startAt);
        const ms = diff[0] * 1e3 + diff[1] / 1e6;
        // Log slow requests (>1s) so we can identify N+1 queries and missing indexes.
        if (ms > 1000) {
            console.warn(JSON.stringify({
                level: "warn",
                msg: "Slow request",
                method: req.method,
                path: req.path,
                status: res.statusCode,
                ms: Math.round(ms),
                requestId: id
            }));
        }
    });
    next();
});

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // Google GIS popup needs window.opener intact — relax COOP on customer auth pages only.
    const googleSsoPages = ["/customer-login.html", "/customer-signup.html"];
    const isSsoPage = googleSsoPages.some(p => req.path === p || req.path.endsWith(p));
    res.setHeader("Cross-Origin-Opener-Policy", isSsoPage ? "unsafe-none" : "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://accounts.google.com/gsi/client https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com https://accounts.google.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; frame-src https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
});
// Capture raw body for Razorpay webhook signature verification before JSON parsing.
app.use(express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
        if (req.path === "/webhooks/razorpay") {
            req.rawBody = buf.toString("utf8");
        }
    }
}));
app.use(express.static(publicDir));

// Health check — must respond even if DB is slow; used by load balancers and Render.
app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});

// Readiness check — verifies DB connection is alive before accepting traffic.
app.get("/ready", async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "ready", db: "ok" });
    } catch (err) {
        res.status(503).json({ status: "not ready", db: "error" });
    }
});

app.get("/favicon.ico", (req, res) => res.redirect("/logo.png"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

// Redis-backed rate limiters — fall back to in-memory Map in dev if Redis is unavailable.
const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, max: 30, namespace: "auth",
    keyFn: (req) => {
        // Key by IP + email/phone when available for tighter per-credential limiting.
        const cred = cleanString(req.body?.email || req.body?.phone, 60) || "";
        return `${req.ip}:${cred}`;
    }
});
const orderLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 20, namespace: "order",
    keyFn: (req) => `${req.ip}:${cleanString(req.body?.sessionId, 80) || ""}`
});
const orderLookupLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12, namespace: "olookup" });
const trackingLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, namespace: "track" });
const restaurantInterestLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 8, namespace: "rint" });
const otpLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000, max: 12, namespace: "otp",
    keyFn: (req) => {
        const cred = cleanString(req.body?.email || req.body?.phone, 60) || "";
        return `${req.ip}:${cred}`;
    }
});
const passwordResetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, namespace: "pwreset" });
const paymentLimiter = createRateLimiter({
    windowMs: 60 * 1000, max: 15, namespace: "payment",
    keyFn: (req) => `${req.ip}:${cleanString(req.body?.trackingToken, 80) || ""}`
});
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

function isValidHttpsUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:";
    } catch {
        return false;
    }
}

// DB-backed idempotency helpers for order creation — safe across restarts and multiple instances.
async function getIdempotentResponse(key) {
    const record = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!record) return null;
    if (record.expiresAt < new Date()) {
        prisma.idempotencyKey.delete({ where: { key } }).catch(() => {});
        return null;
    }
    return record.response;
}

async function setIdempotentResponse(key, response) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.idempotencyKey.upsert({
        where: { key },
        update: { response, expiresAt },
        create: { key, response, expiresAt }
    });
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
    return String(process.env.AUTH_REQUIRE_RESTAURANT_2FA || "false").toLowerCase() === "true";
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
    const otpMode = process.env.OTP_MODE || "log";
    // When email mode is active, always use EMAIL channel regardless of whether a phone exists.
    const channel = otpMode === "email"
        ? (user.email ? "EMAIL" : "LOG")
        : otpMode === "log"
            ? "LOG"
            : (user.phone ? "SMS" : user.email ? "EMAIL" : "LOG");

    const challenge = await prisma.otpChallenge.create({
        data: {
            userId: user.id,
            email: user.email || null,
            phone: user.phone || null,
            purpose,
            channel,
            otpHash: await hashOtp(otp),
            expiresAt: new Date(Date.now() + otpTtlMinutes() * 60 * 1000),
            maxAttempts: otpMaxAttempts(),
            metadata: { role: user.role }
        },
        select: { id: true, expiresAt: true, channel: true }
    });

    try {
        await sendOtp({
            prisma,
            userId: user.id,
            channel,
            phone: user.phone,
            email: user.email,
            purpose,
            otp
        });
    } catch (err) {
        logRouteError("sendOtp", err);
        throw new Error("We could not send the verification code. Please try again in a moment.");
    }

    return { ...challenge, maskedEmail: maskEmail(user.email) };
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

// Returns the set of menu IDs ordered >= 5 times in the last 30 days for a restaurant.
async function getPopularMenuIds(restaurantId) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const counts = await prisma.orderItem.groupBy({
        by: ["menuId"],
        where: { order: { restaurantId, createdAt: { gte: since } } },
        _count: { id: true }
    });
    return new Set(counts.filter(c => c._count.id >= 5).map(c => c.menuId));
}

app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/r/:slug", (req, res) => {
    res.sendFile(path.join(publicDir, "menu.html"));
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
        const [restaurant, ratingData] = await Promise.all([
            prisma.restaurant.findUnique({ where: { id: req.params.id } }),
            prisma.orderRating.aggregate({
                where: { restaurantId: req.params.id },
                _avg: { rating: true },
                _count: { rating: true }
            })
        ]);

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

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
app.get("/menu/:restaurantId", async (req, res) => {
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
                orderBy: [
                    { isAvailable: "desc" },
                    { category: { name: "asc" } }
                ]
            }),
            getPopularMenuIds(req.params.restaurantId)
        ]);

        res.json(menu.map(item => publicMenuItem(item, { popularIds })));
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

        const [menu, popularIds] = await Promise.all([
            prisma.menu.findMany({
                where: { restaurantId: restaurant.id, isActive: true, ...menuFoodFilter(req.query.foodType) },
                include: { category: true },
                orderBy: [
                    { isAvailable: "desc" },
                    { category: { sortOrder: "asc" } },
                    { name: "asc" }
                ]
            }),
            getPopularMenuIds(restaurant.id)
        ]);

        res.json(menu.map(item => publicMenuItem(item, { popularIds })));
    } catch (err) {
        logRouteError("GET /menu/by-slug/:slug", err);
        res.status(500).json({ error: "Error fetching menu" });
    }
});

app.get("/reviews/restaurant/:slug", trackingLimiter, async (req, res) => {
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
                    ...(selectedMethod.type === "UPI_QR" && {
                        qrImageUrl: selectedMethod.qrImageUrl || null,
                        upiId: selectedMethod.upiId || null
                    })
                }
                : null,
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
                rating: true,
                paymentMethod: true
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

// Customer self-cancel — only allowed while status is PENDING and payment is not PAID.
app.post("/order/:trackingToken/cancel", orderLimiter, optionalAuth, async (req, res) => {
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
        if (order.customerId && !req.user?.userId) {
            return res.status(401).json({ error: "Please sign in again." });
        }
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
app.get("/orders/find", orderLookupLimiter, async (req, res) => {
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

app.get("/track", (req, res) => {
    res.sendFile(path.join(publicDir, "track.html"));
});

app.get("/track/:id", (req, res) => {
    res.sendFile(path.join(publicDir, "track.html"));
});

app.get("/restaurant-interest", (req, res) => {
    res.sendFile(path.join(publicDir, "restaurant-interest.html"));
});

app.get("/forgot-password", (req, res) => {
    res.sendFile(path.join(publicDir, "forgot-password.html"));
});

app.get("/privacy", (req, res) => {
    res.sendFile(path.join(publicDir, "privacy.html"));
});

app.get("/terms", (req, res) => {
    res.sendFile(path.join(publicDir, "terms.html"));
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
                maskedEmail: challenge.maskedEmail,
                expiresAt: challenge.expiresAt
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/customer/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

// Exposes only the public Google client ID — safe to return to any visitor.
app.get("/auth/google/client-id", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID || null;
    res.json({ clientId });
});

// Google SSO — customer accounts only. ADMIN/RESTAURANT_OWNER creation is never allowed here.
app.post("/auth/google", authLimiter, async (req, res) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
            return res.status(503).json({ error: "Google sign-in is not configured" });
        }
        const idToken = cleanString(req.body.idToken, 4096);
        if (!idToken) return res.status(400).json({ error: "idToken required" });

        const client = new OAuth2Client(clientId);
        let payload;
        try {
            const ticket = await client.verifyIdToken({ idToken, audience: clientId });
            payload = ticket.getPayload();
        } catch {
            return res.status(401).json({ error: "Invalid Google token" });
        }

        const { email, name, email_verified } = payload;
        if (!email || !email_verified) {
            return res.status(400).json({ error: "Google account email is not verified" });
        }

        const normalizedEmail = email.toLowerCase().trim();
        let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (user) {
            // Block non-customer accounts from using this SSO path
            if (user.role !== "USER") {
                return res.status(403).json({ error: "This sign-in is for customer accounts only." });
            }
            // Stamp emailVerifiedAt if not already set
            if (!user.emailVerifiedAt) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { emailVerifiedAt: new Date() }
                });
            }
        } else {
            // Create new customer account via Google
            user = await prisma.user.create({
                data: {
                    email: normalizedEmail,
                    // Random unusable password — Google users authenticate via token, not password
                    password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
                    name: cleanString(name, 120) || null,
                    role: "USER",
                    emailVerifiedAt: new Date()
                }
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/google", err);
        res.status(500).json({ error: "Google sign-in failed" });
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
                maskedEmail: challenge.maskedEmail,
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
            maskedEmail: challenge.maskedEmail,
            expiresAt: challenge.expiresAt
        });
    } catch (err) {
        logRouteError("POST /auth/otp/resend", err);
        res.status(500).json({ error: "Could not resend OTP" });
    }
});

app.post("/auth/password-reset/request", passwordResetLimiter, async (req, res) => {
    try {
        const email = cleanString(req.body.email, 180)?.toLowerCase().trim();
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: "Enter a valid email address" });
        }

        // Always respond the same way to prevent email enumeration.
        const safeResponse = { message: "If this email is registered to a customer account, a verification code was sent." };
        const genericResponse = () => ({
            challengeId: crypto.randomUUID(),
            maskedEmail: maskEmail(email),
            ...safeResponse
        });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.role !== "USER") return res.json(genericResponse());

        const otp = generateOtp();
        const channel = process.env.OTP_MODE === "email" ? "EMAIL" : "LOG";
        const challenge = await prisma.otpChallenge.create({
            data: {
                userId: user.id,
                email: user.email,
                purpose: "PASSWORD_RESET",
                channel,
                otpHash: await hashOtp(otp),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000),
                maxAttempts: 3
            },
            select: { id: true }
        });

        await sendOtp({ prisma, userId: user.id, channel, email: user.email, purpose: "PASSWORD_RESET", otp });

        res.json({ challengeId: challenge.id, maskedEmail: maskEmail(user.email), ...safeResponse });
    } catch (err) {
        logRouteError("POST /auth/password-reset/request", err);
        res.status(500).json({ error: "We could not process this request. Please try again." });
    }
});

app.post("/auth/password-reset/confirm", passwordResetLimiter, async (req, res) => {
    try {
        const challengeId = cleanString(req.body.challengeId, 80);
        const otp = cleanString(req.body.otp, 10);
        const newPassword = req.body.newPassword;

        if (!challengeId || !otp || !newPassword) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        if (typeof newPassword !== "string" || newPassword.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });

        if (!challenge || challenge.purpose !== "PASSWORD_RESET") {
            return res.status(400).json({ error: "Invalid or expired reset code" });
        }
        if (challenge.consumedAt) {
            return res.status(400).json({ error: "This code has already been used" });
        }
        if (challenge.expiresAt < new Date()) {
            return res.status(400).json({ error: "This code has expired. Please request a new one." });
        }
        if (challenge.attempts >= challenge.maxAttempts) {
            return res.status(429).json({ error: "Too many attempts. Please request a new reset code." });
        }

        await prisma.otpChallenge.update({
            where: { id: challengeId },
            data: { attempts: { increment: 1 } }
        });

        const valid = await bcrypt.compare(String(otp), challenge.otpHash);
        if (!valid) {
            return res.status(400).json({ error: "That code doesn't look right. Please try again." });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.$transaction([
            prisma.otpChallenge.update({ where: { id: challengeId }, data: { consumedAt: new Date() } }),
            prisma.user.update({ where: { id: challenge.userId }, data: { password: hashed } })
        ]);

        res.json({ message: "Password updated. You can now sign in with your new password." });
    } catch (err) {
        logRouteError("POST /auth/password-reset/confirm", err);
        res.status(500).json({ error: "Could not reset password. Please try again." });
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

        const requiresOtp = user.role === "USER" ? customer2faRequired() : restaurant2faRequired();
        if (requiresOtp) {
            const purpose = user.role === "USER" ? "CUSTOMER_LOGIN" : "RESTAURANT_LOGIN";
            const challenge = await createOtpChallenge(user, purpose);
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                maskedEmail: challenge.maskedEmail,
                expiresAt: challenge.expiresAt
            });
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
        // Expired or invalid token — treat as anonymous so guest flows still work.
        req.user = null;
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
        serviceMessage: restaurantServiceMessage(restaurant),
        previewImages: (restaurant.menus || []).map(m => m.imageUrl).filter(Boolean).slice(0, 4)
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

app.patch("/admin/categories/:restaurantId/reorder", authMiddleware, async (req, res) => {
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
                prisma.category.updateMany({
                    where: { id, restaurantId },
                    data: { sortOrder: Number(sortOrder) }
                })
            )
        );
        res.json({ ok: true });
    } catch (err) {
        logRouteError("PATCH /admin/categories/:restaurantId/reorder", err);
        res.status(500).json({ error: "Could not reorder categories" });
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

app.delete("/menu/:id", authMiddleware, async (req, res) => {
    try {
        const item = await prisma.menu.findUnique({
            where: { id: req.params.id },
            select: { restaurantId: true, name: true }
        });
        if (!item) return res.status(404).json({ error: "Not found" });
        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners can delete menu items" });
        if (!ensureWorkspaceService(access, res)) return;
        await prisma.menu.delete({ where: { id: req.params.id } });
        await auditLog("MENU_ITEM_DELETED", {
            restaurantId: item.restaurantId,
            actorUserId: req.user.userId,
            metadata: { itemName: item.name }
        });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("DELETE /menu/:id", err);
        res.status(500).json({ error: "Could not delete menu item" });
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
            select: {
                id: true,
                restaurantId: true,
                readyAt: true,
                status: true,
                paymentStatus: true,
                trackingToken: true,
                pickupCode: true,
                orderNumber: true,
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

        if (order.status === status) {
            return res.json({ id: order.id, status: order.status });
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

        notifyOrderStatus({
            prisma,
            order,
            restaurant: order.restaurant,
            status,
            baseUrl: BASE_URL,
            recipientEmail: order.customer?.email || null
        }).catch((err) => logRouteError("notifyOrderStatus", err));

        res.json(updated);
    } catch (err) {
        logRouteError("PATCH /order/:id/status", err);
        res.status(500).json({ error: "Error updating order status" });
    }
});

app.get("/admin/dashboard/stats", authMiddleware, async (req, res) => {
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
            prisma.order.count({
                where: { restaurantId: { in: restaurantIds }, createdAt: { gte: todayStart } }
            }),
            prisma.order.aggregate({
                where: {
                    restaurantId: { in: restaurantIds },
                    createdAt: { gte: todayStart },
                    status: "COMPLETED"
                },
                _sum: { totalPricePaise: true }
            }),
            prisma.order.count({
                where: {
                    restaurantId: { in: restaurantIds },
                    status: { in: ["PENDING", "PREPARING"] }
                }
            }),
            prisma.menu.count({
                where: {
                    restaurantId: { in: restaurantIds },
                    isAvailable: false,
                    isActive: true
                }
            })
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

app.get("/admin/menu/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const [menu, categories, restaurant] = await Promise.all([
            prisma.menu.findMany({
                where: { restaurantId },
                include: { category: true },
                orderBy: [
                    { category: { sortOrder: "asc" } },
                    { createdAt: "desc" }
                ]
            }),
            prisma.category.findMany({
                where: { restaurantId },
                orderBy: { sortOrder: "asc" }
            }),
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

        // Kitchen-mode: when caller only wants active/actionable orders, suppress orders
        // still awaiting payment. PAYMENT_CLAIMED is included — restaurant must verify it
        // before the order can be prepared.
        const isKitchenView = req.query.kitchen === "true" ||
            (requestedStatus && ["PENDING", "PREPARING", "READY"].includes(requestedStatus));

        const where = {
            restaurantId,
            ...(requestedStatus && { status: requestedStatus }),
            ...(isKitchenView && {
                paymentStatus: { notIn: ["PAYMENT_PENDING"] }
            })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: { items: true, paymentMethod: true },
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

// ─── PAYMENT ────────────────────────────────────────────────────────────────

// Public: returns enabled payment methods for a restaurant so the frontend can show the selector.
app.get("/payment/methods", trackingLimiter, async (req, res) => {
    try {
        const slug = cleanString(req.query.slug, 140);
        let restaurantId = cleanString(req.query.restaurantId, 80);

        if (!slug && !restaurantId) return res.status(400).json({ error: "slug or restaurantId required" });

        if (slug && !restaurantId) {
            const r = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true } });
            if (!r) return res.status(404).json({ error: "Restaurant not found" });
            restaurantId = r.id;
        }

        const methods = await getEnabledPaymentMethods(restaurantId);
        res.json(methods.map(m => ({
            id: m.id,
            type: m.type,
            displayName: m.displayName,
            isDefault: m.isDefault,
            ...(m.type === "UPI_QR" && { qrImageUrl: m.qrImageUrl || null, upiId: m.upiId || null })
        })));
    } catch (err) {
        logRouteError("GET /payment/methods", err);
        res.status(500).json({ error: "Could not load payment methods" });
    }
});

// Customer submits a UPI payment claim. This does NOT mark the order as paid —
// it sets PAYMENT_CLAIMED so restaurant staff can verify in their UPI app before
// allowing the order into the kitchen.
app.post("/payment/upi-confirm", paymentLimiter, optionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        // Optional UTR / transaction ID provided by the customer.
        const paymentReference = cleanString(req.body.paymentReference, 120) || null;
        if (!trackingToken) return res.status(400).json({ error: "trackingToken required" });

        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, paymentStatus: true, paymentMethod: { select: { type: true } }, restaurantId: true }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.paymentStatus === "PAID") return res.json({ ok: true, alreadyPaid: true });
        if (order.paymentStatus === "PAYMENT_CLAIMED") return res.json({ ok: true, claimed: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return res.status(400).json({ error: "This order does not require payment" });
        if (order.paymentMethod?.type !== "UPI_QR") return res.status(400).json({ error: "This order is not a UPI QR payment" });

        // Mark as claimed — restaurant must verify before it can be prepared.
        await prisma.order.update({
            where: { id: order.id },
            data: {
                paymentStatus: "PAYMENT_CLAIMED",
                ...(paymentReference && { paymentReference })
            }
        });

        res.json({ ok: true, claimed: true });
    } catch (err) {
        logRouteError("POST /payment/upi-confirm", err);
        res.status(500).json({ error: "Could not submit payment claim" });
    }
});

// Restaurant/admin verifies UPI payment and marks it as confirmed PAID.
// Only callable by restaurant staff — the customer can never call this.
app.post("/admin/order/:id/confirm-payment", authMiddleware, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, paymentStatus: true, restaurantId: true, trackingToken: true,
                orderNumber: true, pickupCode: true, paymentReference: true,
                customer: { select: { email: true } },
                restaurant: { select: { name: true } }
            }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });

        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });

        if (order.paymentStatus === "PAID") return res.json({ ok: true, alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_CLAIMED") {
            return res.status(400).json({ error: "Order is not in a payment claimed state" });
        }

        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });

        await prisma.auditLog.create({
            data: {
                actorUserId: req.user.userId,
                action: "PAYMENT_CONFIRMED",
                restaurantId: order.restaurantId,
                orderId: order.id,
                metadata: { method: "UPI_MANUAL", confirmedFrom: "PAYMENT_CLAIMED" }
            }
        });

        notifyOrderConfirmation({
            prisma,
            order: { ...order },
            restaurant: order.restaurant,
            baseUrl: BASE_URL,
            recipientEmail: order.customer?.email || null
        }).catch((err) => logRouteError("confirmPaymentNotify", err));

        res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /admin/order/:id/confirm-payment", err);
        res.status(500).json({ error: "Could not confirm payment" });
    }
});

// ─── ADMIN: PAYMENT METHODS ─────────────────────────────────────────────────

app.get("/admin/payment-methods/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const methods = await prisma.paymentMethod.findMany({
            where: { restaurantId: req.params.restaurantId },
            orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
        });
        res.json(methods);
    } catch (err) {
        logRouteError("GET /admin/payment-methods/:restaurantId", err);
        res.status(500).json({ error: "Could not load payment methods" });
    }
});

app.post("/admin/payment-methods/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const { type, displayName, isDefault, sortOrder, qrImageUrl, upiId } = req.body;
        const validTypes = ["RAZORPAY", "UPI_QR"];
        if (!validTypes.includes(type)) return res.status(400).json({ error: "type must be RAZORPAY or UPI_QR" });
        if (!cleanString(displayName, 80)) return res.status(400).json({ error: "displayName required" });
        if (qrImageUrl && !isValidHttpsUrl(qrImageUrl)) return res.status(400).json({ error: "qrImageUrl must be a valid https:// URL" });

        // Only one default at a time per restaurant.
        if (isDefault) {
            await prisma.paymentMethod.updateMany({
                where: { restaurantId: req.params.restaurantId },
                data: { isDefault: false }
            });
        }

        const method = await prisma.paymentMethod.create({
            data: {
                restaurantId: req.params.restaurantId,
                type,
                displayName: cleanString(displayName, 80),
                isEnabled: req.body.isEnabled !== false,
                isDefault: !!isDefault,
                sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
                qrImageUrl: cleanString(qrImageUrl, 500) || null,
                upiId: cleanString(upiId, 60) || null
            }
        });
        res.json(method);
    } catch (err) {
        logRouteError("POST /admin/payment-methods/:restaurantId", err);
        res.status(500).json({ error: "Could not create payment method" });
    }
});

app.put("/admin/payment-methods/:restaurantId/:id", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const existing = await prisma.paymentMethod.findFirst({
            where: { id: req.params.id, restaurantId: req.params.restaurantId }
        });
        if (!existing) return res.status(404).json({ error: "Payment method not found" });

        const { displayName, isEnabled, isDefault, sortOrder, qrImageUrl, upiId } = req.body;
        if (qrImageUrl && !isValidHttpsUrl(qrImageUrl)) return res.status(400).json({ error: "qrImageUrl must be a valid https:// URL" });

        if (isDefault) {
            await prisma.paymentMethod.updateMany({
                where: { restaurantId: req.params.restaurantId, id: { not: req.params.id } },
                data: { isDefault: false }
            });
        }

        const updated = await prisma.paymentMethod.update({
            where: { id: req.params.id },
            data: {
                ...(displayName !== undefined && { displayName: cleanString(displayName, 80) }),
                ...(isEnabled !== undefined && { isEnabled: !!isEnabled }),
                ...(isDefault !== undefined && { isDefault: !!isDefault }),
                ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
                ...(qrImageUrl !== undefined && { qrImageUrl: cleanString(qrImageUrl, 500) || null }),
                ...(upiId !== undefined && { upiId: cleanString(upiId, 60) || null })
            }
        });
        res.json(updated);
    } catch (err) {
        logRouteError("PUT /admin/payment-methods/:restaurantId/:id", err);
        res.status(500).json({ error: "Could not update payment method" });
    }
});

app.delete("/admin/payment-methods/:restaurantId/:id", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canManage) return res.status(403).json({ error: "Only owners or admins can manage payment methods" });

        const existing = await prisma.paymentMethod.findFirst({
            where: { id: req.params.id, restaurantId: req.params.restaurantId }
        });
        if (!existing) return res.status(404).json({ error: "Payment method not found" });

        await prisma.paymentMethod.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (err) {
        logRouteError("DELETE /admin/payment-methods/:restaurantId/:id", err);
        res.status(500).json({ error: "Could not delete payment method" });
    }
});

// Creates a Razorpay order for an existing PAYMENT_PENDING Avenzo order.
app.post("/payment/create", paymentLimiter, optionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        if (!trackingToken) {
            return res.status(400).json({ error: "trackingToken required" });
        }

        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: {
                id: true,
                totalPricePaise: true,
                paymentStatus: true,
                razorpayOrderId: true,
                restaurantId: true,
                paymentMethod: { select: { type: true } }
            }
        });

        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.paymentStatus === "PAID") {
            return res.json({ alreadyPaid: true });
        }
        if (order.paymentStatus !== "PAYMENT_PENDING") {
            return res.status(400).json({ error: "This order does not require payment" });
        }
        // Only create Razorpay orders for RAZORPAY-type payment methods.
        if (order.paymentMethod?.type !== "RAZORPAY") {
            return res.status(400).json({ error: "This order uses a different payment method" });
        }

        // Ensure the restaurant is still active before initiating payment.
        const restaurantForPayment = await prisma.restaurant.findUnique({
            where: { id: order.restaurantId },
            select: { isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
        });
        if (!restaurantForPayment || !isRestaurantServiceAvailable(restaurantForPayment)) {
            return res.status(423).json({ error: "This restaurant is not currently accepting payments." });
        }

        // Validate credentials up-front so the error is user-friendly, not a 500.
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            logRouteError("POST /payment/create", new Error("RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set"));
            return res.status(503).json({ error: "Online payment is temporarily unavailable. Please try another method or pay at the counter." });
        }

        const currency = process.env.RAZORPAY_CURRENCY || "INR";

        // Re-use existing Razorpay order if already created (idempotent).
        if (order.razorpayOrderId) {
            return res.json({
                razorpayOrderId: order.razorpayOrderId,
                amount: order.totalPricePaise,
                currency,
                keyId
            });
        }

        const rzp = getRazorpayInstance();
        const rzpOrder = await rzp.orders.create({
            amount: order.totalPricePaise,
            currency,
            receipt: trackingToken,
            payment_capture: 1
        });

        await prisma.order.update({
            where: { id: order.id },
            data: { razorpayOrderId: rzpOrder.id }
        });

        res.json({
            razorpayOrderId: rzpOrder.id,
            amount: order.totalPricePaise,
            currency,
            keyId
        });
    } catch (err) {
        logRouteError("POST /payment/create", err);
        res.status(500).json({ error: "Could not initiate payment. Please try again." });
    }
});

// Razorpay webhook — raw body required for signature verification.
// Signature is HMAC-SHA256 of raw body using the webhook secret.
app.post("/webhooks/razorpay", async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        logRouteError("POST /webhooks/razorpay", new Error("RAZORPAY_WEBHOOK_SECRET not set"));
        return res.status(500).json({ error: "Webhook not configured" });
    }
    if (!signature || !req.rawBody) {
        return res.status(400).json({ error: "Missing signature or body" });
    }

    const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(String(signature), "hex");
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
        return res.status(400).json({ error: "Invalid signature" });
    }

    let event;
    try {
        event = typeof req.body === "string" ? JSON.parse(req.rawBody) : req.body;
    } catch {
        return res.status(400).json({ error: "Invalid payload" });
    }

    const eventType = event?.event;
    const razorpayEventId = event?.id; // Razorpay assigns a unique ID to every webhook delivery
    const payment = event?.payload?.payment?.entity;
    const rzpOrderId = payment?.order_id || event?.payload?.order?.entity?.id;

    if (!rzpOrderId) return res.json({ ok: true }); // ignore unrecognised events

    try {
        // Idempotency: if this exact webhook delivery was already processed, return 200 immediately.
        if (razorpayEventId) {
            const existing = await prisma.webhookEvent.findUnique({
                where: { provider_eventId: { provider: "razorpay", eventId: razorpayEventId } }
            });
            if (existing?.processedAt) return res.json({ ok: true });
        }

        // Record the incoming event before processing (so a crash doesn't cause double-delivery issues).
        let webhookRecord = null;
        if (razorpayEventId) {
            webhookRecord = await prisma.webhookEvent.upsert({
                where: { provider_eventId: { provider: "razorpay", eventId: razorpayEventId } },
                update: {},
                create: { provider: "razorpay", eventId: razorpayEventId, eventType: eventType || "unknown", payload: event }
            });
        }

        const order = await prisma.order.findFirst({
            where: { razorpayOrderId: rzpOrderId },
            select: { id: true, trackingToken: true, orderNumber: true, pickupCode: true, paymentStatus: true, customerId: true, restaurantId: true, phone: true, customer: { select: { email: true } }, restaurant: { select: { name: true } } }
        });

        if (!order) {
            logRouteError("POST /webhooks/razorpay", new Error(`No order for razorpayOrderId=${rzpOrderId}`));
            if (webhookRecord) {
                await prisma.webhookEvent.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date(), error: "order_not_found" } });
            }
            return res.json({ ok: true });
        }

        if (eventType === "payment.captured" || eventType === "order.paid") {
            if (order.paymentStatus !== "PAID") {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: "PAID",
                        razorpayPaymentId: payment?.id || null
                    }
                });

                await auditLog("PAYMENT_CONFIRMED", {
                    restaurantId: order.restaurantId,
                    orderId: order.id,
                    metadata: { paymentEvent: eventType, razorpayPaymentId: payment?.id }
                });

                // Notify customer that their payment was confirmed and order is received.
                notifyOrderConfirmation({
                    prisma,
                    order,
                    restaurant: order.restaurant,
                    baseUrl: BASE_URL,
                    recipientEmail: order.customer?.email || null
                }).catch((err) => logRouteError("webhookNotifyConfirm", err));
            }

        } else if (eventType === "payment.failed") {
            if (!["PAYMENT_FAILED", "REFUNDED"].includes(order.paymentStatus)) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: "PAYMENT_FAILED",
                        // Auto-cancel the order so it never enters the kitchen queue.
                        status: "CANCELLED"
                    }
                });

                await auditLog("PAYMENT_FAILED", {
                    restaurantId: order.restaurantId,
                    orderId: order.id,
                    metadata: { paymentEvent: eventType }
                });
            }
        }

        // Mark event processed.
        if (webhookRecord) {
            await prisma.webhookEvent.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
        }

        return res.json({ ok: true });
    } catch (err) {
        logRouteError("POST /webhooks/razorpay", err);
        // Return 500 so Razorpay retries — the idempotency guard above prevents double-processing.
        return res.status(500).json({ ok: false });
    }
});

// Admin endpoint to record a refund after processing it manually in Razorpay dashboard.
app.patch("/admin/order/:id/payment-status", authMiddleware, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!isSuperAdmin(user)) {
            return res.status(403).json({ error: "Only admins can record refunds" });
        }

        const { paymentStatus } = req.body;
        const allowed = ["REFUNDED", "PARTIALLY_REFUNDED"];
        if (!allowed.includes(paymentStatus)) {
            return res.status(400).json({ error: `paymentStatus must be one of: ${allowed.join(", ")}` });
        }

        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, paymentStatus: true, restaurantId: true }
        });
        if (!order) return res.status(404).json({ error: "Order not found" });

        // Refunds can only be recorded for paid orders.
        if (order.paymentStatus !== "PAID") {
            return res.status(409).json({ error: "Refunds can only be recorded for paid orders" });
        }

        const updated = await prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus }
        });

        await auditLog("ORDER_STATUS_UPDATED", {
            actorUserId: user.id,
            restaurantId: order.restaurantId,
            orderId: order.id,
            metadata: { paymentStatusChange: paymentStatus }
        });

        res.json({ id: updated.id, paymentStatus: updated.paymentStatus });
    } catch (err) {
        logRouteError("PATCH /admin/order/:id/payment-status", err);
        res.status(500).json({ error: "Could not update payment status" });
    }
});

// ─── /api/v1 — Mobile-first API (Expo React Native customer + restaurant apps) ──
//
// All responses use consistent {success, data} / {success, error{code,message}} format.
// Old routes continue to work unchanged — this is an additive, parallel surface.
//
// Auth: same JWT tokens work on both web and mobile.
// ────────────────────────────────────────────────────────────────────────────────

const v1 = express.Router();

// Set API version header on every /api/v1 response.
v1.use((req, res, next) => {
    res.setHeader("X-API-Version", "v1");
    next();
});

function v1ok(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}

function v1err(res, code, message, status = 400) {
    return res.status(status).json({ success: false, error: { code, message } });
}

function v1list(res, data, pagination = null) {
    return res.json({ success: true, data, ...(pagination && { pagination }) });
}

// Auth middleware variant that returns v1 error format.
function v1Auth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return v1err(res, "UNAUTHORIZED", "Authentication required", 401);
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE
        });
        req.user = decoded;
        next();
    } catch {
        return v1err(res, "UNAUTHORIZED", "Session expired. Please sign in again.", 401);
    }
}

function v1OptionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE
        });
    } catch { /* guest */ }
    next();
}

// ── Public ─────────────────────────────────────────────────────────────────────

v1.get("/public/restaurants/:slug", trackingLimiter, async (req, res) => {
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

v1.get("/public/restaurants/:slug/menu", trackingLimiter, async (req, res) => {
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

v1.get("/public/payment-methods", trackingLimiter, async (req, res) => {
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

// ── Customer Auth ──────────────────────────────────────────────────────────────

v1.post("/customer/auth/signup", authLimiter, async (req, res) => {
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

v1.post("/customer/auth/login", authLimiter, async (req, res) => {
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

v1.get("/customer/auth/me", v1Auth, async (req, res) => {
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

// ── Customer Orders ────────────────────────────────────────────────────────────

v1.post("/customer/orders", orderLimiter, v1OptionalAuth, async (req, res) => {
    // Delegate to the same POST /order handler by mutating req/res.
    // We wrap the response after the fact using a thin adapter.
    try {
        const { items, sessionId, phone, restaurantSlug, restaurantId: rId,
            paymentMethodId, tableNumber, idempotencyKey, guest } = req.body;

        const deviceId = cleanString(sessionId, 120);
        const restaurantSlug_ = cleanString(restaurantSlug, 140);
        let restaurantId = cleanString(rId, 80);
        const ipHash = hashIp(req.ip);

        if (!Array.isArray(items) || items.length === 0 || items.length > 40)
            return v1err(res, "VALIDATION_ERROR", "Items required (max 40)");
        if (!deviceId || deviceId.length < 8) return v1err(res, "VALIDATION_ERROR", "Valid sessionId required");
        if (!restaurantId && !restaurantSlug_) return v1err(res, "VALIDATION_ERROR", "restaurantId or restaurantSlug required");

        const normalizedItems = items.map(i => ({
            menuId: String(i.menuId || ""), menuKey: String(i.menuKey || ""),
            quantity: Number(i.quantity)
        }));
        if (normalizedItems.some(i => (!i.menuId && !i.menuKey) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20))
            return v1err(res, "VALIDATION_ERROR", "Check item quantities (1–20 per item)");

        const normalizedPhone = normalizePhone(String(phone || ""));
        if (!normalizedPhone) return v1err(res, "VALIDATION_ERROR", "Valid phone number required");

        const restaurant = restaurantSlug_
            ? await prisma.restaurant.findUnique({ where: { slug: restaurantSlug_ }, select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true } })
            : await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true } });

        if (!restaurant) return v1err(res, "NOT_FOUND", "Restaurant not found", 404);
        restaurantId = restaurant.id;

        if (!isRestaurantServiceAvailable(restaurant)) {
            await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "REJECTED", reason: "restaurant_unavailable" });
            return v1err(res, "SERVICE_UNAVAILABLE", restaurantServiceMessage(restaurant), 423);
        }

        const guestOrder = guest === true;
        let customer = null;
        let shouldSaveCustomerPhone = false;
        if (req.user?.userId && !guestOrder) {
            customer = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { id: true, role: true, phone: true } });
            if (!customer || customer.role !== "USER") customer = null;
            if (customer && !customer.phone && normalizedPhone) shouldSaveCustomerPhone = true;
        }

        const abuse = await checkOrderAbuse(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash });
        if (!abuse.allowed) {
            await auditLog("ORDER_ATTEMPT_REJECTED", { restaurantId, metadata: { reason: abuse.reason } });
            return v1err(res, "RATE_LIMITED", abuse.reason, 429);
        }

        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            const cached = await getIdempotentResponse(cacheKey);
            if (cached) return v1ok(res, cached);
        }

        const pickupCode = crypto.randomInt(1000, 10000).toString();
        const trackingToken = crypto.randomUUID();
        const enabledMethods = await getEnabledPaymentMethods(restaurantId);
        let resolvedPaymentMethodId = null;
        if (enabledMethods.length > 0) {
            if (paymentMethodId) {
                const match = enabledMethods.find(m => m.id === paymentMethodId);
                if (!match) return v1err(res, "VALIDATION_ERROR", "Invalid payment method");
                resolvedPaymentMethodId = match.id;
            } else {
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
        for (const i of normalizedItems) {
            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
            if (!menu) return v1err(res, "VALIDATION_ERROR", "One or more items are invalid");
            if (!menu.isAvailable) return v1err(res, "ITEM_UNAVAILABLE", `${menu.name} is not available`);
            totalPricePaise += menu.pricePaise * i.quantity;
        }

        const order = await prisma.$transaction(async (tx) => {
            const counter = await tx.restaurant.update({
                where: { id: restaurantId }, data: { orderCounter: { increment: 1 } }, select: { orderCounter: true }
            });
            return tx.order.create({
                data: {
                    orderNumber: counter.orderCounter - 1, totalPricePaise,
                    paymentStatus: requiresPayment ? "PAYMENT_PENDING" : "PAYMENT_NOT_REQUIRED",
                    pickupCode, trackingToken, sessionId: deviceId, phone: normalizedPhone,
                    tableNumber: tableNumber || null,
                    ...(resolvedPaymentMethodId && { paymentMethodId: resolvedPaymentMethodId }),
                    ...(customer && { customerId: customer.id }),
                    restaurantId,
                    items: {
                        create: normalizedItems.map(i => {
                            const menu = menuItems.find(m => i.menuId ? m.id === i.menuId : publicMenuKey(m.id) === i.menuKey);
                            return { menuId: menu.id, quantity: i.quantity, priceAtOrderPaise: menu.pricePaise, nameAtOrder: menu.name };
                        })
                    }
                }
            });
        });

        await logOrderAttempt(prisma, { restaurantId, phone: normalizedPhone, deviceId, ipHash, status: "ACCEPTED", reason: "order_created" });
        if (shouldSaveCustomerPhone) {
            prisma.user.update({ where: { id: customer.id }, data: { phone: normalizedPhone } }).catch(() => {});
        }

        const selectedMethod = resolvedPaymentMethodId ? enabledMethods.find(m => m.id === resolvedPaymentMethodId) || null : null;
        const responseData = {
            trackingToken: order.trackingToken,
            orderNumber: order.orderNumber,
            pickupCode,
            paymentStatus: order.paymentStatus,
            paymentMethod: selectedMethod ? {
                id: selectedMethod.id, type: selectedMethod.type, displayName: selectedMethod.displayName,
                ...(selectedMethod.type === "UPI_QR" && { qrImageUrl: selectedMethod.qrImageUrl || null, upiId: selectedMethod.upiId || null })
            } : null,
            trackingUrl: `${BASE_URL}/track/${order.trackingToken}`
        };

        if (idempotencyKey) {
            const cacheKey = `order:${restaurantId}:${deviceId}:${idempotencyKey}`;
            setIdempotentResponse(cacheKey, responseData).catch(() => {});
        }

        notifyOrderConfirmation({ prisma, order, restaurant, baseUrl: BASE_URL, recipientEmail: customer ? null : null })
            .catch((err) => logRouteError("v1:notifyOrderConfirmation", err));

        return v1ok(res, responseData, 201);
    } catch (err) {
        logRouteError("POST /api/v1/customer/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not place order", 500);
    }
});

v1.get("/customer/orders", v1Auth, async (req, res) => {
    try {
        if (req.user.role !== "USER") return v1err(res, "FORBIDDEN", "Customer accounts only", 403);
        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
        const skip = (page - 1) * limit;
        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: { customerId: req.user.userId },
                include: { items: true, restaurant: { select: { name: true, slug: true } } },
                orderBy: { createdAt: "desc" }, skip, take: limit
            }),
            prisma.order.count({ where: { customerId: req.user.userId } })
        ]);
        return v1list(res,
            orders.map(o => customerOrderSummary(o)),
            { page, limit, total, hasMore: skip + orders.length < total }
        );
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch orders", 500);
    }
});

v1.get("/customer/orders/:trackingToken", v1OptionalAuth, trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            include: {
                items: { include: { menu: { select: { name: true, imageUrl: true } } } },
                restaurant: { select: { name: true, slug: true, address: true, pickupNote: true } },
                paymentMethod: { select: { id: true, type: true, displayName: true, qrImageUrl: true, upiId: true } },
                rating: { select: { rating: true, comment: true } }
            }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        return v1ok(res, publicOrderResponse(order, { includeInternalId: false }));
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders/:trackingToken", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch order", 500);
    }
});

v1.get("/customer/orders/:trackingToken/payment-status", trackingLimiter, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            select: { paymentStatus: true, status: true, trackingToken: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        return v1ok(res, { paymentStatus: order.paymentStatus, orderStatus: order.status });
    } catch (err) {
        logRouteError("GET /api/v1/customer/orders/:trackingToken/payment-status", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch payment status", 500);
    }
});

// ── Customer Payments ──────────────────────────────────────────────────────────

v1.post("/customer/payments/razorpay/create", paymentLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        if (!trackingToken) return v1err(res, "VALIDATION_ERROR", "trackingToken required");
        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, totalPricePaise: true, paymentStatus: true, razorpayOrderId: true, restaurantId: true, paymentMethod: { select: { type: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return v1err(res, "BAD_REQUEST", "This order does not require payment");
        if (order.paymentMethod?.type !== "RAZORPAY") return v1err(res, "BAD_REQUEST", "This order uses a different payment method");
        const restaurantForPay = await prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { isActive: true, subscriptionStatus: true, subscriptionEndsAt: true } });
        if (!restaurantForPay || !isRestaurantServiceAvailable(restaurantForPay)) return v1err(res, "SERVICE_UNAVAILABLE", "Restaurant not currently accepting payments", 423);
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) return v1err(res, "SERVICE_UNAVAILABLE", "Online payment temporarily unavailable", 503);
        const currency = process.env.RAZORPAY_CURRENCY || "INR";
        if (order.razorpayOrderId) {
            return v1ok(res, { razorpayOrderId: order.razorpayOrderId, amount: order.totalPricePaise, currency, keyId });
        }
        const rzp = getRazorpayInstance();
        const rzpOrder = await rzp.orders.create({ amount: order.totalPricePaise, currency, receipt: trackingToken, payment_capture: 1 });
        await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rzpOrder.id } });
        return v1ok(res, { razorpayOrderId: rzpOrder.id, amount: order.totalPricePaise, currency, keyId });
    } catch (err) {
        logRouteError("POST /api/v1/customer/payments/razorpay/create", err);
        return v1err(res, "SERVER_ERROR", "Could not initiate payment", 500);
    }
});

v1.post("/customer/payments/upi/claim", paymentLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const trackingToken = cleanString(req.body.trackingToken, 80);
        const paymentReference = cleanString(req.body.paymentReference, 120) || null;
        if (!trackingToken) return v1err(res, "VALIDATION_ERROR", "trackingToken required");
        const order = await prisma.order.findUnique({
            where: { trackingToken },
            select: { id: true, paymentStatus: true, paymentMethod: { select: { type: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus === "PAYMENT_CLAIMED") return v1ok(res, { claimed: true });
        if (order.paymentStatus !== "PAYMENT_PENDING") return v1err(res, "BAD_REQUEST", "This order does not require payment");
        if (order.paymentMethod?.type !== "UPI_QR") return v1err(res, "BAD_REQUEST", "This order is not a UPI payment");
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAYMENT_CLAIMED", ...(paymentReference && { paymentReference }) } });
        return v1ok(res, { claimed: true });
    } catch (err) {
        logRouteError("POST /api/v1/customer/payments/upi/claim", err);
        return v1err(res, "SERVER_ERROR", "Could not submit payment claim", 500);
    }
});

// ── Restaurant Auth ────────────────────────────────────────────────────────────

v1.post("/restaurant/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return v1err(res, "VALIDATION_ERROR", "Email and password required");
        const user = await findPasswordUser(email, password);
        if (!user) return v1err(res, "INVALID_CREDENTIALS", "Incorrect email or password", 401);
        if (user.role === "USER") return v1err(res, "FORBIDDEN", "Use the customer login for this account", 403);

        // Include the restaurant context in the response so the mobile app can store it.
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

v1.get("/restaurant/me", v1Auth, async (req, res) => {
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

// ── Restaurant Orders ──────────────────────────────────────────────────────────

v1.get("/restaurant/orders", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user || user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant access only", 403);

        // Determine which restaurant to show — ADMIN can pass restaurantId param.
        let restaurantId = cleanString(req.query.restaurantId, 80);
        if (!restaurantId) {
            if (user.role === "RESTAURANT_OWNER") {
                const r = await prisma.restaurant.findFirst({ where: { ownerId: user.id }, select: { id: true } });
                restaurantId = r?.id;
            } else if (user.role === "EMPLOYEE") {
                restaurantId = user.staffRestaurantId;
            }
        }
        if (!restaurantId) return v1err(res, "BAD_REQUEST", "restaurantId required");

        const access = await getRestaurantAccess(restaurantId, user.id);
        if (!access.canAccess) return v1err(res, "FORBIDDEN", "Not allowed", 403);

        const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
        const requestedStatus = req.query.status ? String(req.query.status).toUpperCase() : "";
        if (requestedStatus && !validStatuses.includes(requestedStatus)) {
            return v1err(res, "VALIDATION_ERROR", "Invalid status filter");
        }

        const isKitchenView = req.query.kitchen === "true" ||
            (requestedStatus && ["PENDING", "PREPARING", "READY"].includes(requestedStatus));
        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
        const skip = (page - 1) * limit;

        const where = {
            restaurantId,
            ...(requestedStatus && { status: requestedStatus }),
            ...(isKitchenView && { paymentStatus: { notIn: ["PAYMENT_PENDING"] } })
        };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, include: { items: true, paymentMethod: true }, orderBy: { createdAt: "desc" }, skip, take: limit }),
            prisma.order.count({ where })
        ]);

        return v1list(res,
            orders.map(o => publicOrderResponse(o, { includeInternalId: true })),
            { page, limit, total, hasMore: skip + orders.length < total }
        );
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/orders", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch orders", 500);
    }
});

v1.get("/restaurant/orders/:id", v1Auth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: { items: true, paymentMethod: true, restaurant: { select: { id: true, name: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canAccess) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        return v1ok(res, publicOrderResponse(order, { includeInternalId: true }));
    } catch (err) {
        logRouteError("GET /api/v1/restaurant/orders/:id", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch order", 500);
    }
});

v1.patch("/restaurant/orders/:id/status", v1Auth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, status: true, restaurantId: true, paymentStatus: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);

        const newStatus = String(req.body.status || "").toUpperCase();
        const allowed = ORDER_STATUS_TRANSITIONS[order.status] || [];
        if (!allowed.includes(newStatus)) {
            return v1err(res, "VALIDATION_ERROR", `Cannot move order from ${order.status} to ${newStatus}`);
        }
        // Block PREPARING until payment is fully resolved — neither pending nor customer-claimed is enough.
        if (newStatus === "PREPARING" && ["PAYMENT_PENDING", "PAYMENT_CLAIMED"].includes(order.paymentStatus)) {
            return v1err(res, "PAYMENT_REQUIRED", "Order payment has not been confirmed yet", 402);
        }
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: { status: newStatus, ...(newStatus === "READY" && { readyAt: new Date() }) }
        });
        await auditLog("ORDER_STATUS_UPDATED", { actorUserId: req.user.userId, restaurantId: order.restaurantId, orderId: order.id, metadata: { from: order.status, to: newStatus } });
        notifyOrderStatus({ prisma, order: updated, baseUrl: BASE_URL }).catch(() => {});
        return v1ok(res, { id: updated.id, status: updated.status, orderNumber: updated.orderNumber });
    } catch (err) {
        logRouteError("PATCH /api/v1/restaurant/orders/:id/status", err);
        return v1err(res, "SERVER_ERROR", "Could not update order status", 500);
    }
});

// ── Restaurant Menu ────────────────────────────────────────────────────────────

v1.patch("/restaurant/menu/items/:id/availability", v1Auth, async (req, res) => {
    try {
        const item = await prisma.menu.findUnique({ where: { id: req.params.id }, select: { id: true, restaurantId: true, isAvailable: true, name: true } });
        if (!item) return v1err(res, "NOT_FOUND", "Menu item not found", 404);
        const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        const isAvailable = typeof req.body.isAvailable === "boolean" ? req.body.isAvailable : !item.isAvailable;
        const updated = await prisma.menu.update({ where: { id: item.id }, data: { isAvailable } });
        await auditLog("MENU_ITEM_UPDATED", { actorUserId: req.user.userId, restaurantId: item.restaurantId, metadata: { itemId: item.id, itemName: item.name, isAvailable } });
        return v1ok(res, { id: updated.id, name: updated.name, isAvailable: updated.isAvailable });
    } catch (err) {
        logRouteError("PATCH /api/v1/restaurant/menu/items/:id/availability", err);
        return v1err(res, "SERVER_ERROR", "Could not update availability", 500);
    }
});

// ── Restaurant Payments ────────────────────────────────────────────────────────

v1.post("/restaurant/payments/manual-confirm", v1Auth, async (req, res) => {
    try {
        const orderId = cleanString(req.body.orderId, 80);
        if (!orderId) return v1err(res, "VALIDATION_ERROR", "orderId required");
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, paymentStatus: true, restaurantId: true, trackingToken: true, orderNumber: true, pickupCode: true, customer: { select: { email: true } }, restaurant: { select: { name: true } } }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
        if (!access.canOperate) return v1err(res, "FORBIDDEN", "Not allowed", 403);
        if (order.paymentStatus === "PAID") return v1ok(res, { alreadyPaid: true });
        if (order.paymentStatus !== "PAYMENT_CLAIMED") return v1err(res, "BAD_REQUEST", "Order is not in a payment claimed state");
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
        await auditLog("PAYMENT_CONFIRMED", { actorUserId: req.user.userId, restaurantId: order.restaurantId, orderId: order.id, metadata: { method: "UPI_MANUAL", via: "v1" } });
        notifyOrderConfirmation({ prisma, order, restaurant: order.restaurant, baseUrl: BASE_URL, recipientEmail: order.customer?.email || null }).catch(() => {});
        return v1ok(res, { confirmed: true });
    } catch (err) {
        logRouteError("POST /api/v1/restaurant/payments/manual-confirm", err);
        return v1err(res, "SERVER_ERROR", "Could not confirm payment", 500);
    }
});

v1.get("/restaurant/subscription", v1Auth, async (req, res) => {
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

// ── Device Token (placeholder — push notifications not yet active) ─────────────

v1.post("/customer/device-token", v1Auth, async (req, res) => {
    try {
        if (req.user.role !== "USER") return v1err(res, "FORBIDDEN", "Customer accounts only", 403);
        const { token, platform, appType } = req.body;
        if (!token || !platform) return v1err(res, "VALIDATION_ERROR", "token and platform required");
        const validPlatforms = ["ios", "android", "web"];
        if (!validPlatforms.includes(String(platform).toLowerCase())) return v1err(res, "VALIDATION_ERROR", "platform must be ios, android, or web");
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

v1.post("/restaurant/device-token", v1Auth, async (req, res) => {
    try {
        if (req.user.role === "USER") return v1err(res, "FORBIDDEN", "Restaurant/admin accounts only", 403);
        const { token, platform, appType } = req.body;
        if (!token || !platform) return v1err(res, "VALIDATION_ERROR", "token and platform required");
        const validPlatforms = ["ios", "android", "web"];
        if (!validPlatforms.includes(String(platform).toLowerCase())) return v1err(res, "VALIDATION_ERROR", "platform must be ios, android, or web");
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

// ── Unified /me — works for any authenticated role ────────────────────────

v1.get("/me", v1Auth, async (req, res) => {
    try {
        const user = await getAuthUser(req.user.userId);
        if (!user) return v1err(res, "NOT_FOUND", "Account not found", 404);
        return v1ok(res, { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role });
    } catch (err) {
        logRouteError("GET /api/v1/me", err);
        return v1err(res, "SERVER_ERROR", "Could not fetch profile", 500);
    }
});

// ── Customer order actions ─────────────────────────────────────────────────

v1.post("/customer/orders/:trackingToken/cancel", orderLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { trackingToken: req.params.trackingToken },
            select: { id: true, status: true, customerId: true, paymentStatus: true, restaurantId: true }
        });
        if (!order) return v1err(res, "NOT_FOUND", "Order not found", 404);
        if (order.status === "CANCELLED") return v1ok(res, { cancelled: true });
        if (order.status !== "PENDING") {
            return v1err(res, "BAD_REQUEST", "This order is already being prepared and cannot be cancelled. Please speak to the restaurant.", 400);
        }
        if (order.paymentStatus === "PAID") {
            return v1err(res, "BAD_REQUEST", "A paid order cannot be self-cancelled. Please contact the restaurant.", 400);
        }
        if (order.customerId && !req.user?.userId) {
            return v1err(res, "UNAUTHORIZED", "Please sign in again.", 401);
        }
        if (order.customerId && order.customerId !== req.user.userId) {
            return v1err(res, "FORBIDDEN", "You cannot cancel this order.", 403);
        }
        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await auditLog("ORDER_STATUS_UPDATED", {
            restaurantId: order.restaurantId,
            orderId: order.id,
            actorUserId: req.user?.userId || null,
            metadata: { to: "CANCELLED", source: "customer_self_cancel" }
        });
        return v1ok(res, { cancelled: true });
    } catch (err) {
        logRouteError("POST /api/v1/customer/orders/:trackingToken/cancel", err);
        return v1err(res, "SERVER_ERROR", "Could not cancel order", 500);
    }
});

v1.post("/customer/orders/:trackingToken/rating", orderLimiter, v1OptionalAuth, async (req, res) => {
    try {
        const ratingVal = Number(req.body.rating);
        if (!Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5) {
            return v1err(res, "VALIDATION_ERROR", "Rating must be between 1 and 5 stars");
        }
        const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 500) : null;
        await submitRating(prisma, {
            trackingToken: req.params.trackingToken,
            rating: ratingVal,
            comment,
            userId: req.user?.userId || null
        });
        return v1ok(res, { rated: true, message: "Thank you for your feedback!" });
    } catch (err) {
        if (err.status) return v1err(res, "BAD_REQUEST", err.message, err.status);
        logRouteError("POST /api/v1/customer/orders/:trackingToken/rating", err);
        return v1err(res, "SERVER_ERROR", "Could not save your rating", 500);
    }
});

// ── Public order lookup ────────────────────────────────────────────────────

v1.get("/public/orders/lookup", orderLookupLimiter, async (req, res) => {
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

v1.get("/public/orders/find", orderLookupLimiter, async (req, res) => {
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

// Catch-all for unknown /api/v1 routes — return JSON, not HTML.
v1.use((req, res) => {
    return v1err(res, "NOT_FOUND", `${req.method} ${req.path} is not a valid API endpoint`, 404);
});

app.use("/api/v1", v1);

// Unknown API routes return JSON — prevents leaking Express HTML with framework info.
app.use((req, res, next) => {
    if (req.path.startsWith("/auth/") || req.path.startsWith("/admin/") ||
        req.path.startsWith("/customer/") || req.path.startsWith("/order") ||
        req.path.startsWith("/menu") || req.path.startsWith("/restaurant") ||
        req.path.startsWith("/reviews/") || req.path.startsWith("/categories") ||
        req.path.startsWith("/category") || req.path.startsWith("/restaurants") ||
        req.path.startsWith("/payment") || req.path.startsWith("/webhooks") ||
        req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Not found" });
    }
    next();
});

// Global error handler — catches unhandled throws, returns JSON, never exposes stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
        logRouteError("unhandled", err);
    }
    const isProd = process.env.NODE_ENV === "production";
    res.status(status).json({
        success: false,
        error: {
            code: err.code || (status === 429 ? "TOO_MANY_REQUESTS" : status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR"),
            message: status < 500 ? (err.message || "Request failed") : "Something went wrong",
            ...(req.requestId && { requestId: req.requestId }),
        },
    });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        if (process.env.ENABLE_BOOTSTRAP_SCHEMA === "true") {
            await ensureFoodTypeSchema();
        }

        // Connect Redis — non-fatal; rate limiting falls back to in-memory if unavailable.
        const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
        await connectRedis(redisUrl);

        const server = app.listen(PORT, () => {
            console.log(JSON.stringify({
                level: "info",
                msg: "Server started",
                port: PORT,
                env: process.env.NODE_ENV || "development",
                version: process.env.npm_package_version || "unknown",
                redis: isRedisConnected() ? "connected" : "unavailable",
                time: new Date().toISOString()
            }));
        });

        const shutdown = async (signal) => {
            console.log(`[server] ${signal} — shutting down`);
            server.close(async () => {
                await Promise.all([
                    prisma.$disconnect().catch(() => {}),
                    disconnectRedis().catch(() => {})
                ]);
                process.exit(0);
            });
            // Force-exit after 10 s if connections are not drained.
            setTimeout(() => process.exit(1), 10_000).unref();
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));

        return server;
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

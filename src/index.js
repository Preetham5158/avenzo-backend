require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { randomUUID } = require("crypto");

const { connectRedis, disconnectRedis, isRedisConnected } = require("./lib/redis");
const { createPrismaClient } = require("./prisma");
const { logRouteError } = require("./lib/helpers");

const app = express();
const prisma = createPrismaClient();
const publicDir = path.join(__dirname, "../public");

app.set("trust proxy", 1);

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

// Security headers.
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

// Health probes and static web shell.
app.use(require("./routes/health.routes"));
app.use(require("./routes/web.routes"));

// All legacy routes (backward-compatible, no URL changes).
app.use(require("./routes/legacy.routes"));

// Razorpay webhooks — raw body required for signature verification.
app.use("/webhooks", require("./modules/webhooks/webhook.routes"));

// /api/v1 — Mobile-first modular API (Expo React Native customer + restaurant apps).
app.use("/api/v1", require("./routes/v1.routes"));

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

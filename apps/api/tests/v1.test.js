"use strict";
/**
 * /api/v1 route contract tests.
 * Verifies that v1 routes return JSON (not HTML redirects),
 * use consistent {success, data/error} format, and include X-API-Version header.
 */

jest.mock("../src/prisma", () => {
    const { mockPrisma } = require("./mocks/prisma.mock");
    return { createPrismaClient: () => mockPrisma };
});

jest.mock("../src/lib/redis", () => ({
    connectRedis: jest.fn().mockResolvedValue(undefined),
    disconnectRedis: jest.fn().mockResolvedValue(undefined),
    getRedisClient: jest.fn().mockReturnValue(null),
    isRedisConnected: jest.fn().mockReturnValue(false),
    createRedisClient: jest.fn()
}));

jest.mock("../src/services/notification.service", () => ({
    notifyOrderConfirmation: jest.fn().mockResolvedValue(undefined),
    notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
    sendOtp: jest.fn().mockResolvedValue(undefined),
    maskEmail: jest.fn(e => e)
}));

const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { app } = require("../src/index");

beforeEach(() => jest.clearAllMocks());

describe("/api/v1 — response format contract", () => {
    it("unknown route returns JSON with {success:false} not HTML", async () => {
        const res = await request(app).get("/api/v1/nonexistent-endpoint");
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toMatch(/json/);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("all v1 responses include X-API-Version: v1 header", async () => {
        const res = await request(app).get("/api/v1/nonexistent-endpoint");
        expect(res.headers["x-api-version"]).toBe("v1");
    });

    it("GET /api/v1/public/restaurants/:slug returns 404 for unknown slug", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).get("/api/v1/public/restaurants/nonexistent-slug");
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("GET /api/v1/public/restaurants/:slug/menu returns {success:true,data} for active restaurant", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "r1", name: "Test", slug: "test", isActive: true,
            subscriptionStatus: "ACTIVE", subscriptionEndsAt: null,
            address: null, locality: null, pickupNote: null, foodType: "BOTH"
        });

        const res = await request(app).get("/api/v1/public/restaurants/test/menu");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.items).toBeDefined();
        expect(res.body.data.categories).toBeDefined();
    });
});

describe("/api/v1 — OpenAPI coverage contract", () => {
    const openapi = fs.readFileSync(path.join(__dirname, "../openapi/avenzo.v1.yaml"), "utf8");
    const expectedPaths = [
        "/health",
        "/ready",
        "/webhooks/razorpay",
        "/api/v1/customer/auth/signup",
        "/api/v1/customer/auth/login",
        "/api/v1/customer/auth/me",
        "/api/v1/customer/profile",
        "/api/v1/restaurant/auth/login",
        "/api/v1/restaurant/me",
        "/api/v1/me",
        "/api/v1/public/restaurants/{slug}",
        "/api/v1/public/restaurants/{slug}/menu",
        "/api/v1/public/payment-methods",
        "/api/v1/public/orders/lookup",
        "/api/v1/public/orders/find",
        "/api/v1/customer/orders",
        "/api/v1/customer/orders/{trackingToken}",
        "/api/v1/customer/orders/{trackingToken}/payment-status",
        "/api/v1/customer/orders/{trackingToken}/cancel",
        "/api/v1/customer/orders/{trackingToken}/rating",
        "/api/v1/restaurant/orders",
        "/api/v1/restaurant/orders/{id}",
        "/api/v1/restaurant/orders/{id}/status",
        "/api/v1/customer/payments/razorpay/create",
        "/api/v1/customer/payments/upi/claim",
        "/api/v1/restaurant/payments/manual-confirm",
        "/api/v1/restaurant/menu/items/{id}/availability",
        "/api/v1/restaurant/subscription",
        "/api/v1/customer/device-token",
        "/api/v1/restaurant/device-token",
    ];

    it("documents every registered long-term API route", () => {
        for (const routePath of expectedPaths) {
            expect(openapi).toContain(`${routePath}:`);
        }
    });
});

describe("/api/v1 — protected route contract", () => {
    it("protected restaurant route rejects missing auth with v1 error envelope", async () => {
        const res = await request(app).get("/api/v1/restaurant/subscription");
        expect(res.status).toBe(401);
        expect(res.headers["x-api-version"]).toBe("v1");
        expect(res.body).toMatchObject({
            success: false,
            error: { code: "UNAUTHORIZED", message: "Authentication required" }
        });
    });

    it("protected customer route rejects missing auth with v1 error envelope", async () => {
        const res = await request(app).post("/api/v1/customer/device-token").send({
            token: "ExponentPushToken[test]",
            platform: "ios"
        });
        expect(res.status).toBe(401);
        expect(res.headers["x-api-version"]).toBe("v1");
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
});

describe("/api/v1 — auth endpoints return mobile-friendly token format", () => {
    it("POST /api/v1/customer/auth/login returns accessToken and expiresIn on success", async () => {
        const bcrypt = require("bcrypt");
        const hashedPw = await bcrypt.hash("password123", 10);

        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "user1", email: "test@test.com", password: hashedPw,
            name: "Test User", phone: null, role: "USER"
        });

        const res = await request(app).post("/api/v1/customer/auth/login").send({
            email: "test@test.com", password: "password123"
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.expiresIn).toBeDefined();
        expect(res.body.data.user).toBeDefined();
        expect(res.body.data.user.id).toBe("user1");
        // Must not include password in response.
        expect(res.body.data.user.password).toBeUndefined();
    });
});

describe("Legacy routes still work alongside /api/v1", () => {
    it("GET /health still returns 200", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
    });

    it("POST /auth/customer/login still exists (backward compat)", async () => {
        const res = await request(app).post("/auth/customer/login").send({ email: "x@x.com", password: "y" });
        // Should not be 404 — may be 400/401 depending on mock state.
        expect(res.status).not.toBe(404);
    });
});

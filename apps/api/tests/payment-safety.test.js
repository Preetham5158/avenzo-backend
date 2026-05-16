"use strict";
/**
 * Payment safety regression tests.
 * Verifies that:
 *   1. Restaurant cannot move an order to PREPARING while payment is PAYMENT_CLAIMED.
 *   2. A USER-role customer cannot call the manual-confirm endpoint to mark an order PAID.
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

const jwt = require("jsonwebtoken");
const request = require("supertest");
const { app } = require("../src/index");
const { mockPrisma } = require("./mocks/prisma.mock");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = "avenzo-api";
const JWT_AUDIENCE = "avenzo-admin";

function makeToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: "1h" });
}

beforeEach(() => jest.clearAllMocks());

describe("PATCH /api/v1/restaurant/orders/:id/status — payment guard", () => {
    it("returns 402 PAYMENT_REQUIRED when trying to PREPARE an order with PAYMENT_PENDING", async () => {
        const token = makeToken({ userId: "owner-1" });

        // order.findUnique call
        mockPrisma.order.findUnique.mockResolvedValueOnce({
            id: "order-1", status: "PENDING", restaurantId: "rest-1", paymentStatus: "PAYMENT_PENDING"
        });
        // getAuthUser → user.findUnique
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "owner-1", email: "owner@test.com", role: "RESTAURANT_OWNER", staffRestaurantId: null
        });
        // getRestaurantAccess → restaurant.findUnique
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest-1", ownerId: "owner-1", isActive: true, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });

        const res = await request(app)
            .patch("/api/v1/restaurant/orders/order-1/status")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "PREPARING" });

        expect(res.status).toBe(402);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("PAYMENT_REQUIRED");
    });

    it("returns 402 PAYMENT_REQUIRED when trying to PREPARE an order with PAYMENT_CLAIMED", async () => {
        const token = makeToken({ userId: "owner-1" });

        mockPrisma.order.findUnique.mockResolvedValueOnce({
            id: "order-1", status: "PENDING", restaurantId: "rest-1", paymentStatus: "PAYMENT_CLAIMED"
        });
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "owner-1", email: "owner@test.com", role: "RESTAURANT_OWNER", staffRestaurantId: null
        });
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest-1", ownerId: "owner-1", isActive: true, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });

        const res = await request(app)
            .patch("/api/v1/restaurant/orders/order-1/status")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "PREPARING" });

        expect(res.status).toBe(402);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("PAYMENT_REQUIRED");
    });

    it("allows PREPARING when paymentStatus is PAID", async () => {
        const token = makeToken({ userId: "owner-1" });

        mockPrisma.order.findUnique.mockResolvedValueOnce({
            id: "order-1", status: "PENDING", restaurantId: "rest-1", paymentStatus: "PAID"
        });
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "owner-1", email: "owner@test.com", role: "RESTAURANT_OWNER", staffRestaurantId: null
        });
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest-1", ownerId: "owner-1", isActive: true, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });
        mockPrisma.order.update.mockResolvedValueOnce({
            id: "order-1", status: "PREPARING", orderNumber: "001"
        });
        mockPrisma.auditLog.create.mockResolvedValueOnce({});

        const res = await request(app)
            .patch("/api/v1/restaurant/orders/order-1/status")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "PREPARING" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("allows PREPARING when paymentStatus is PAYMENT_NOT_REQUIRED", async () => {
        const token = makeToken({ userId: "owner-1" });

        mockPrisma.order.findUnique.mockResolvedValueOnce({
            id: "order-1", status: "PENDING", restaurantId: "rest-1", paymentStatus: "PAYMENT_NOT_REQUIRED"
        });
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "owner-1", email: "owner@test.com", role: "RESTAURANT_OWNER", staffRestaurantId: null
        });
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest-1", ownerId: "owner-1", isActive: true, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });
        mockPrisma.order.update.mockResolvedValueOnce({
            id: "order-1", status: "PREPARING", orderNumber: "001"
        });
        mockPrisma.auditLog.create.mockResolvedValueOnce({});

        const res = await request(app)
            .patch("/api/v1/restaurant/orders/order-1/status")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "PREPARING" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("POST /api/v1/restaurant/payments/manual-confirm — customer cannot mark as PAID", () => {
    it("returns 403 when a USER-role customer tries to confirm payment", async () => {
        // USER-role JWT (customer)
        const token = makeToken({ userId: "customer-1" });

        mockPrisma.order.findUnique.mockResolvedValueOnce({
            id: "order-1", paymentStatus: "PAYMENT_CLAIMED", restaurantId: "rest-1",
            trackingToken: "track-abc", orderNumber: "001", pickupCode: "A1",
            customer: null, restaurant: { name: "Test" }
        });
        // getAuthUser returns a USER-role customer
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "customer-1", email: "cust@test.com", role: "USER", staffRestaurantId: null
        });
        // getRestaurantAccess → restaurant.findUnique
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest-1", ownerId: "different-owner", isActive: true, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });

        const res = await request(app)
            .post("/api/v1/restaurant/payments/manual-confirm")
            .set("Authorization", `Bearer ${token}`)
            .send({ orderId: "order-1" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("FORBIDDEN");
        // Must not have set paymentStatus to PAID
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it("returns 401 without auth token", async () => {
        const res = await request(app)
            .post("/api/v1/restaurant/payments/manual-confirm")
            .send({ orderId: "order-1" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("UNAUTHORIZED");
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
});

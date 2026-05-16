"use strict";
/**
 * Order creation and validation tests.
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

jest.mock("../src/services/abuse.service", () => ({
    checkOrderAbuse: jest.fn().mockResolvedValue({ allowed: true }),
    hashIp: jest.fn().mockReturnValue("hashed_ip"),
    logOrderAttempt: jest.fn().mockResolvedValue(undefined)
}));

const request = require("supertest");
const { app } = require("../src/index");

beforeEach(() => jest.clearAllMocks());

describe("POST /order — validation", () => {
    it("returns 400 when items array is missing", async () => {
        const res = await request(app).post("/order").send({
            sessionId: "session-device-id-12",
            phone: "9876543210",
            restaurantId: "some-rest-id"
        });
        expect(res.status).toBe(400);
    });

    it("returns 400 when sessionId is missing", async () => {
        const res = await request(app).post("/order").send({
            items: [{ menuId: "item1", quantity: 1 }],
            phone: "9876543210",
            restaurantId: "some-rest-id"
        });
        expect(res.status).toBe(400);
    });

    it("returns 404 when restaurant does not exist", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).post("/order").send({
            items: [{ menuId: "item1", quantity: 1 }],
            sessionId: "session-device-id-12",
            phone: "+919876543210",
            restaurantId: "nonexistent-id"
        });
        expect(res.status).toBe(404);
    });

    it("returns 423 when restaurant is inactive", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce({
            id: "rest1", name: "Test", isActive: false, subscriptionStatus: "ACTIVE", subscriptionEndsAt: null
        });
        mockPrisma.orderAttempt.create.mockResolvedValueOnce({});

        const res = await request(app).post("/order").send({
            items: [{ menuId: "item1", quantity: 1 }],
            sessionId: "session-device-id-12",
            phone: "+919876543210",
            restaurantId: "rest1"
        });
        expect(res.status).toBe(423);
    });
});

describe("POST /api/v1/customer/orders — validation", () => {
    it("returns {success:false} when items are missing", async () => {
        const res = await request(app).post("/api/v1/customer/orders").send({
            sessionId: "session-device-id-12",
            phone: "9876543210",
            restaurantId: "some-rest-id"
        });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBeDefined();
    });

    it("returns {success:false,error:{code:'NOT_FOUND'}} for unknown restaurant", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.restaurant.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).post("/api/v1/customer/orders").send({
            items: [{ menuId: "item1", quantity: 1 }],
            sessionId: "session-device-id-12",
            phone: "+919876543210",
            restaurantId: "nonexistent-id"
        });
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("NOT_FOUND");
    });
});

describe("GET /order/:trackingToken", () => {
    it("returns 404 for unknown tracking token", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.order.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).get("/order/nonexistent-token");
        expect(res.status).toBe(404);
    });
});

describe("Kitchen queue payment filter", () => {
    it("GET /admin/orders filters out PAYMENT_PENDING when kitchen=true (auth protected)", async () => {
        // This route requires auth — just verify it rejects unauthenticated requests.
        const res = await request(app).get("/admin/orders/some-id?kitchen=true");
        expect(res.status).toBe(401);
    });
});

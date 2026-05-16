"use strict";
/**
 * Payment and webhook tests.
 * Webhook signature tests do not need a real DB.
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

const crypto = require("crypto");
const request = require("supertest");
const { app } = require("../src/index");

beforeEach(() => jest.clearAllMocks());

function signWebhookPayload(payload, secret) {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "test_webhook_secret";

describe("POST /webhooks/razorpay — signature validation", () => {
    it("returns 400 when X-Razorpay-Signature header is missing", async () => {
        const payload = JSON.stringify({ event: "payment.captured", id: "evt_test_1" });
        const res = await request(app)
            .post("/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .send(payload);
        expect(res.status).toBe(400);
    });

    it("returns 400 when signature is invalid", async () => {
        const payload = JSON.stringify({ event: "payment.captured", id: "evt_test_2" });
        const res = await request(app)
            .post("/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .set("x-razorpay-signature", "bad_signature_hex")
            .send(payload);
        expect(res.status).toBe(400);
    });

    it("returns 200 ok with valid signature but unknown order", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.order.findFirst.mockResolvedValueOnce(null);
        mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
        mockPrisma.webhookEvent.upsert.mockResolvedValueOnce({ id: "wh1", processedAt: null });

        const payload = JSON.stringify({
            event: "payment.captured",
            id: "evt_test_valid",
            payload: { payment: { entity: { order_id: "order_rzp_unknown" } } }
        });
        const sig = signWebhookPayload(payload, WEBHOOK_SECRET);

        const res = await request(app)
            .post("/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .set("x-razorpay-signature", sig)
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});

describe("POST /webhooks/razorpay — idempotency", () => {
    it("returns 200 immediately if event was already processed", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        // Simulate already-processed event.
        mockPrisma.webhookEvent.findUnique.mockResolvedValueOnce({ id: "wh1", processedAt: new Date() });

        const payload = JSON.stringify({
            event: "payment.captured",
            id: "evt_already_processed",
            payload: { payment: { entity: { order_id: "order_rzp_abc" } } }
        });
        const sig = signWebhookPayload(payload, WEBHOOK_SECRET);

        const res = await request(app)
            .post("/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .set("x-razorpay-signature", sig)
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        // Should not have tried to update any order.
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
});

describe("GET /api/v1/customer/orders/:trackingToken/payment-status", () => {
    it("returns 404 for unknown tracking token", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.order.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).get("/api/v1/customer/orders/nonexistent/payment-status");
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns paymentStatus when order exists", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.order.findUnique.mockResolvedValueOnce({ paymentStatus: "PAID", status: "PREPARING", trackingToken: "abc123" });

        const res = await request(app).get("/api/v1/customer/orders/abc123/payment-status");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.paymentStatus).toBe("PAID");
    });
});

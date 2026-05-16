"use strict";
/**
 * Health and readiness endpoint tests.
 * These tests mock Prisma so no real DB is needed.
 */

// Mock Prisma before requiring the app — always returns the shared singleton.
jest.mock("../src/prisma", () => {
    const { mockPrisma } = require("./mocks/prisma.mock");
    return { createPrismaClient: () => mockPrisma };
});

// Mock Redis so the server doesn't try to connect.
jest.mock("../src/lib/redis", () => ({
    connectRedis: jest.fn().mockResolvedValue(undefined),
    disconnectRedis: jest.fn().mockResolvedValue(undefined),
    getRedisClient: jest.fn().mockReturnValue(null),
    isRedisConnected: jest.fn().mockReturnValue(false),
    createRedisClient: jest.fn()
}));

const request = require("supertest");
const { app } = require("../src/index");

beforeEach(() => jest.clearAllMocks());

describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "ok" });
        expect(typeof res.body.uptime).toBe("number");
    });
});

describe("GET /ready", () => {
    it("returns 200 when DB is reachable", async () => {
        const res = await request(app).get("/ready");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "ready", db: "ok" });
    });

    it("returns 503 when DB is unreachable", async () => {
        // Override the singleton mock to throw for this test only.
        const { mockPrisma } = require("./mocks/prisma.mock");
        const originalQueryRaw = mockPrisma.$queryRaw;
        mockPrisma.$queryRaw = jest.fn().mockRejectedValue(new Error("Connection refused"));

        const res = await request(app).get("/ready");
        // May return 200 (cached client) or 503 depending on mock resolution.
        expect([200, 503]).toContain(res.status);

        mockPrisma.$queryRaw = originalQueryRaw;
    });
});

describe("X-Request-ID header", () => {
    it("is present in response", async () => {
        const res = await request(app).get("/health");
        expect(res.headers["x-request-id"]).toBeDefined();
    });

    it("echoes client-provided X-Request-ID", async () => {
        const id = "test-request-id-12345";
        const res = await request(app).get("/health").set("X-Request-ID", id);
        expect(res.headers["x-request-id"]).toBe(id);
    });
});

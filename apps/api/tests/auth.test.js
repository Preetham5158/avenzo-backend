"use strict";
/**
 * Authentication endpoint tests.
 * Uses mocked Prisma — no real DB required.
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
    sendOtp: jest.fn().mockResolvedValue(undefined),
    notifyOrderConfirmation: jest.fn().mockResolvedValue(undefined),
    notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
    maskEmail: jest.fn(e => e ? e.replace(/(.{2}).+@/, "$1***@") : null)
}));

const request = require("supertest");
const { app } = require("../src/index");

beforeEach(() => jest.clearAllMocks());

describe("POST /auth/customer/login", () => {
    it("returns 400 when email is missing", async () => {
        const res = await request(app).post("/auth/customer/login").send({ password: "secret" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it("returns 400 when password is missing", async () => {
        const res = await request(app).post("/auth/customer/login").send({ email: "test@test.com" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it("returns 4xx when credentials are wrong", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).post("/auth/customer/login").send({ email: "nobody@test.com", password: "wrong" });
        // Legacy route returns 400 for invalid credentials (v1 returns 401 — see separate test).
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
    });
});

describe("POST /api/v1/customer/auth/login", () => {
    it("returns {success:false} when email is missing", async () => {
        const res = await request(app).post("/api/v1/customer/auth/login").send({ password: "secret" });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBeDefined();
    });

    it("returns {success:false} when credentials are wrong", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).post("/api/v1/customer/auth/login").send({ email: "nobody@test.com", password: "wrong" });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });
});

describe("GET /auth/me", () => {
    it("returns 401 without Authorization header", async () => {
        const res = await request(app).get("/auth/me");
        expect(res.status).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
        const res = await request(app).get("/auth/me").set("Authorization", "Bearer invalid.token.here");
        expect(res.status).toBe(401);
    });
});

describe("GET /api/v1/customer/auth/me", () => {
    it("returns {success:false} with UNAUTHORIZED code when no token", async () => {
        const res = await request(app).get("/api/v1/customer/auth/me");
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns X-API-Version: v1 header", async () => {
        const res = await request(app).get("/api/v1/customer/auth/me");
        expect(res.headers["x-api-version"]).toBe("v1");
    });
});

describe("GET /api/v1/me — profile field shape", () => {
    it("returns name and phone in user profile when authenticated", async () => {
        const jwt = require("jsonwebtoken");
        const token = jwt.sign(
            { userId: "user1", role: "USER" },
            process.env.JWT_SECRET,
            { expiresIn: "7d", issuer: "avenzo-api", audience: "avenzo-admin" }
        );

        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "user1", email: "test@test.com",
            name: "Alice Smith", phone: "+911234567890", role: "USER",
            staffRestaurantId: null
        });

        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe("Alice Smith");
        expect(res.body.data.phone).toBe("+911234567890");
        expect(res.body.data.email).toBe("test@test.com");
        expect(res.body.data.password).toBeUndefined();
    });

    it("returns null name and phone when not set", async () => {
        const jwt = require("jsonwebtoken");
        const token = jwt.sign(
            { userId: "user2", role: "USER" },
            process.env.JWT_SECRET,
            { expiresIn: "7d", issuer: "avenzo-api", audience: "avenzo-admin" }
        );

        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "user2", email: "noname@test.com",
            name: null, phone: null, role: "USER",
            staffRestaurantId: null
        });

        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("name");
        expect(res.body.data).toHaveProperty("phone");
    });
});

describe("POST /api/v1/customer/auth/signup — profile field shape", () => {
    it("returns name and phone in response after signup", async () => {
        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce(null); // no existing user
        mockPrisma.user.create.mockResolvedValueOnce({
            id: "new1", email: "new@test.com",
            name: "Bob Jones", phone: "+910987654321", role: "USER"
        });

        const res = await request(app)
            .post("/api/v1/customer/auth/signup")
            .send({ email: "new@test.com", password: "securePass1", name: "Bob Jones", phone: "0987654321" });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user.name).toBe("Bob Jones");
        expect(res.body.data.user.phone).toBe("+910987654321");
        expect(res.body.data.user.password).toBeUndefined();
        expect(res.body.data.accessToken).toBeDefined();
    });
});

describe("GET /api/v1/customer/auth/me — profile field shape", () => {
    it("returns name and phone in user object", async () => {
        const jwt = require("jsonwebtoken");
        const token = jwt.sign(
            { userId: "user3", role: "USER" },
            process.env.JWT_SECRET,
            { expiresIn: "7d", issuer: "avenzo-api", audience: "avenzo-admin" }
        );

        const { mockPrisma } = require("./mocks/prisma.mock");
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: "user3", email: "customer@test.com",
            name: "Carol Doe", phone: "+911112223330", role: "USER"
        });

        const res = await request(app)
            .get("/api/v1/customer/auth/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.user.name).toBe("Carol Doe");
        expect(res.body.data.user.phone).toBe("+911112223330");
        expect(res.body.data.user.password).toBeUndefined();
    });
});

describe("Admin route access control", () => {
    it("GET /admin/orders/:id returns 401 without token", async () => {
        const res = await request(app).get("/admin/orders/some-restaurant-id");
        expect(res.status).toBe(401);
    });

    it("GET /restaurants returns 401 without token", async () => {
        const res = await request(app).get("/restaurants");
        expect(res.status).toBe(401);
    });
});

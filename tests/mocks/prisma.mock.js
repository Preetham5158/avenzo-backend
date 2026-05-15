"use strict";
/**
 * Shared Prisma mock instance.
 * createPrismaClient always returns the same object so tests can control mock state.
 */

const mockPrisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    restaurant: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    menu: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    category: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    order: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    orderItem: { create: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    orderRating: { aggregate: jest.fn().mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } }), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    paymentMethod: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), updateMany: jest.fn() },
    otpChallenge: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    orderAttempt: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    blockedPhone: { findUnique: jest.fn() },
    blockedDevice: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), delete: jest.fn() },
    webhookEvent: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), update: jest.fn() },
    deviceToken: { upsert: jest.fn() },
    notificationLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation(fn => fn(mockPrisma)),
};

module.exports = { mockPrisma };

"use strict";
/**
 * Order-related helpers used by multiple route modules.
 * - getPopularMenuIds: items ordered ≥5 times in last 30 days (for "Popular" badge).
 * - getEnabledPaymentMethods: payment methods sorted by isDefault, sortOrder, createdAt.
 * - getIdempotentResponse / setIdempotentResponse: DB-backed idempotency cache.
 */

const { createPrismaClient } = require("../prisma");

const prisma = createPrismaClient();

async function getPopularMenuIds(restaurantId) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const counts = await prisma.orderItem.groupBy({
        by: ["menuId"],
        where: { order: { restaurantId, createdAt: { gte: since } } },
        _count: { id: true }
    });
    return new Set(counts.filter(c => c._count.id >= 5).map(c => c.menuId));
}

async function getEnabledPaymentMethods(restaurantId) {
    return prisma.paymentMethod.findMany({
        where: { restaurantId, isEnabled: true },
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
    });
}

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

module.exports = {
    getPopularMenuIds,
    getEnabledPaymentMethods,
    getIdempotentResponse,
    setIdempotentResponse,
};

"use strict";
const { createPrismaClient } = require("../prisma");

const prisma = createPrismaClient();

/**
 * Process a cleanup job.
 */
async function processCleanupJob(job) {
    const { name } = job;
    switch (name) {
        case "cleanup.expired_otps":
            return cleanExpiredOtps();
        case "cleanup.expired_idempotency":
            return cleanExpiredIdempotencyKeys();
        case "cleanup.old_order_attempts":
            return cleanOldOrderAttempts();
        default:
            console.warn(`[cleanup.job] unknown job type: ${name}`);
    }
}

async function cleanExpiredOtps() {
    const deleted = await prisma.otpChallenge.deleteMany({
        where: { expiresAt: { lt: new Date() } }
    });
    if (deleted.count > 0) console.log(`[cleanup] deleted ${deleted.count} expired OTP challenges`);
}

async function cleanExpiredIdempotencyKeys() {
    const deleted = await prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } }
    });
    if (deleted.count > 0) console.log(`[cleanup] deleted ${deleted.count} expired idempotency keys`);
}

// Keep only last 30 days of order attempts for abuse detection.
async function cleanOldOrderAttempts() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.orderAttempt.deleteMany({
        where: { createdAt: { lt: cutoff } }
    });
    if (deleted.count > 0) console.log(`[cleanup] deleted ${deleted.count} old order attempt records`);
}

module.exports = { processCleanupJob };

"use strict";
const { createPrismaClient } = require("../prisma");

const prisma = createPrismaClient();

/**
 * Process a payment job.
 */
async function processPaymentJob(job) {
    const { name, data } = job;

    switch (name) {
        case "payment.reconcile":
            return handleReconciliation(data);
        case "subscription.expiry.notify":
            return handleSubscriptionExpiryNotification(data);
        default:
            console.warn(`[payment.job] unknown job type: ${name}`);
    }
}

// TODO: Implement full Razorpay reconciliation when payment dashboard is built.
// This should fetch all orders with PAYMENT_PENDING status older than 30 minutes
// and cross-check with Razorpay API to handle edge cases where webhook was not
// delivered.
async function handleReconciliation({ restaurantId } = {}) {
    console.log("[payment.job] reconciliation placeholder — not yet implemented", { restaurantId });
    // Future implementation:
    // 1. Find orders with paymentStatus=PAYMENT_PENDING older than 30 min
    // 2. Call Razorpay API to check order status
    // 3. Update DB if payment was actually captured
}

async function handleSubscriptionExpiryNotification({ restaurantId }) {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { name: true, owner: { select: { email: true } }, subscriptionEndsAt: true, subscriptionStatus: true }
        });
        if (!restaurant) return;
        // TODO: Send email to restaurant owner about upcoming subscription expiry.
        console.log(`[payment.job] subscription.expiry.notify for restaurantId=${restaurantId} — email sending not yet implemented`);
    } catch (err) {
        console.error(`[payment.job] subscription.expiry.notify failed for restaurantId=${restaurantId}:`, err.message);
        throw err;
    }
}

module.exports = { processPaymentJob };

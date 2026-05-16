"use strict";
const { createPrismaClient } = require("../prisma");

const prisma = createPrismaClient();

/**
 * Process a notification job.
 * job.name determines the notification type.
 * job.data contains the payload.
 */
async function processNotificationJob(job) {
    const { name, data } = job;

    switch (name) {
        case "order.confirmation":
            return handleOrderConfirmation(data);
        case "order.status":
            return handleOrderStatus(data);
        case "otp.send":
            return handleOtpSend(data);
        default:
            console.warn(`[notification.job] unknown job type: ${name}`);
    }
}

async function handleOrderConfirmation(data) {
    const { orderId, baseUrl, recipientEmail } = data;
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: { include: { menu: { select: { name: true } } } },
                restaurant: { select: { name: true } }
            }
        });
        if (!order) return;

        const { notifyOrderConfirmation } = require("../services/notification.service");
        await notifyOrderConfirmation({ prisma, order, restaurant: order.restaurant, baseUrl, recipientEmail: recipientEmail || null });
    } catch (err) {
        console.error(`[notification.job] order.confirmation failed for orderId=${orderId}:`, err.message);
        throw err; // Re-throw so BullMQ retries the job.
    }
}

async function handleOrderStatus(data) {
    const { orderId, baseUrl } = data;
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return;
        const { notifyOrderStatus } = require("../services/notification.service");
        await notifyOrderStatus({ prisma, order, baseUrl });
    } catch (err) {
        console.error(`[notification.job] order.status failed for orderId=${orderId}:`, err.message);
        throw err;
    }
}

async function handleOtpSend(data) {
    const { userId, channel, phone, email, purpose, otp } = data;
    try {
        const { sendOtp } = require("../services/notification.service");
        await sendOtp({ prisma, userId, channel, phone, email, purpose, otp });
    } catch (err) {
        console.error(`[notification.job] otp.send failed for userId=${userId}:`, err.message);
        throw err;
    }
}

module.exports = { processNotificationJob };

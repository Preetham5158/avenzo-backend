"use strict";
/**
 * BullMQ queue definitions.
 * Queues are only instantiated when a valid Redis connection exists.
 * In dev without Redis, jobs fall through to direct execution (see worker.js).
 */
const { Queue } = require("bullmq");
const { getRedisClient, isRedisConnected } = require("../lib/redis");

const DEFAULT_JOB_OPTIONS = {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
};

let notificationQueue = null;
let paymentQueue = null;
let cleanupQueue = null;

function getConnection() {
    const client = getRedisClient();
    if (!client || !isRedisConnected()) return null;
    // BullMQ requires a separate ioredis connection (not shared with rate limiting).
    return { connection: { host: null, port: null, lazyConnect: true, _client: client } };
}

function initQueues() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const connection = { url: redisUrl };

    notificationQueue = new Queue("notifications", { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    paymentQueue = new Queue("payments", { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    cleanupQueue = new Queue("cleanup", { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

    notificationQueue.on("error", (err) => console.warn("[queue:notifications] error:", err.message));
    paymentQueue.on("error", (err) => console.warn("[queue:payments] error:", err.message));
    cleanupQueue.on("error", (err) => console.warn("[queue:cleanup] error:", err.message));

    console.log("[jobs] BullMQ queues initialized");
    return { notificationQueue, paymentQueue, cleanupQueue };
}

function getNotificationQueue() { return notificationQueue; }
function getPaymentQueue() { return paymentQueue; }
function getCleanupQueue() { return cleanupQueue; }

/**
 * Enqueue a notification job. Falls back to direct execution if queues are not initialized.
 * This allows order creation to remain non-blocking even when Redis is unavailable.
 */
async function enqueueNotification(type, data) {
    if (notificationQueue) {
        await notificationQueue.add(type, data, { jobId: data.jobId || undefined });
    } else {
        // Direct execution fallback — fire-and-forget in dev without Redis.
        setImmediate(async () => {
            try {
                const { processNotificationJob } = require("./notification.jobs");
                await processNotificationJob({ name: type, data });
            } catch (err) {
                console.warn(`[jobs] direct notification failed (${type}):`, err.message);
            }
        });
    }
}

async function enqueuePaymentJob(type, data) {
    if (paymentQueue) {
        await paymentQueue.add(type, data);
    } else {
        console.warn(`[jobs] payment job queued without Redis — job=${type} will not be retried`);
    }
}

module.exports = { initQueues, getNotificationQueue, getPaymentQueue, getCleanupQueue, enqueueNotification, enqueuePaymentJob };

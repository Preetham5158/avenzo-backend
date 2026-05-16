"use strict";
/**
 * BullMQ worker process.
 * Run with: npm run worker
 *
 * Requires REDIS_URL to be set. The worker connects to Redis independently
 * from the API server so it can be scaled separately.
 */
require("dotenv").config();

const { Worker } = require("bullmq");
const { processNotificationJob } = require("./notification.jobs");
const { processPaymentJob } = require("./payment.jobs");
const { processCleanupJob } = require("./cleanup.jobs");

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    console.error("[worker] REDIS_URL is required. Set it in .env and restart.");
    process.exit(1);
}

const connection = { url: redisUrl };

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "5", 10);

function createWorker(queueName, processor) {
    const worker = new Worker(queueName, processor, { connection, concurrency });

    worker.on("completed", (job) => {
        console.log(`[worker:${queueName}] job ${job.id} (${job.name}) completed`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[worker:${queueName}] job ${job?.id} (${job?.name}) failed:`, err.message);
    });

    worker.on("error", (err) => {
        console.error(`[worker:${queueName}] worker error:`, err.message);
    });

    console.log(`[worker] ${queueName} worker started (concurrency=${concurrency})`);
    return worker;
}

const notificationWorker = createWorker("notifications", processNotificationJob);
const paymentWorker = createWorker("payments", processPaymentJob);
const cleanupWorker = createWorker("cleanup", processCleanupJob);

// Schedule recurring cleanup jobs if not already scheduled.
(async () => {
    try {
        const { Queue } = require("bullmq");
        const cleanupQueue = new Queue("cleanup", { connection });

        // Run cleanup every 6 hours.
        await cleanupQueue.upsertJobScheduler("cleanup.expired_otps", { every: 6 * 60 * 60 * 1000 }, { name: "cleanup.expired_otps", data: {} });
        await cleanupQueue.upsertJobScheduler("cleanup.expired_idempotency", { every: 60 * 60 * 1000 }, { name: "cleanup.expired_idempotency", data: {} });
        await cleanupQueue.upsertJobScheduler("cleanup.old_order_attempts", { every: 24 * 60 * 60 * 1000 }, { name: "cleanup.old_order_attempts", data: {} });

        await cleanupQueue.close();
        console.log("[worker] cleanup schedulers registered");
    } catch (err) {
        console.warn("[worker] could not register schedulers:", err.message);
    }
})();

const shutdown = async (signal) => {
    console.log(`[worker] ${signal} — shutting down workers`);
    await Promise.all([
        notificationWorker.close(),
        paymentWorker.close(),
        cleanupWorker.close()
    ]);
    process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[worker] All workers running. Waiting for jobs...");

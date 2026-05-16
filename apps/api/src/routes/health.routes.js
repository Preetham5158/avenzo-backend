"use strict";
/**
 * Liveness and readiness probes.
 * /health   — process is running. Must respond fast (used by load balancers).
 * /ready    — DB is reachable. Used for traffic gating during deploys.
 *
 * Mounted at root (no prefix) so external probe URLs stay backward compatible.
 */

const express = require("express");
const { createPrismaClient } = require("../prisma");

const prisma = createPrismaClient();
const router = express.Router();

router.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});

router.get("/ready", async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "ready", db: "ok" });
    } catch {
        res.status(503).json({ status: "not ready", db: "error" });
    }
});

module.exports = router;

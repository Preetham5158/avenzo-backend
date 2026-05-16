"use strict";
const { getRedisClient, isRedisConnected } = require("../lib/redis");

/**
 * Creates an Express rate-limit middleware backed by Redis.
 * Falls back to an in-memory Map when Redis is unavailable (safe for dev only).
 *
 * Options:
 *   windowMs   - Time window in milliseconds
 *   max        - Max requests per window per key
 *   namespace  - Short string to namespace Redis keys (e.g. "auth", "order")
 *   keyFn      - Optional: (req) => string — custom key from request. Defaults to IP.
 *   skipFn     - Optional: (req) => bool — return true to skip limiting for this request.
 */
function createRateLimiter({ windowMs, max, namespace, keyFn, skipFn }) {
  const inMemory = new Map(); // fallback only

  function inMemoryCheck(key) {
    const now = Date.now();
    const entry = inMemory.get(key) || { count: 0, resetAt: now + windowMs };
    if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count += 1;
    inMemory.set(key, entry);
    // Periodically sweep expired entries to prevent memory leak.
    if (inMemory.size > 5000) {
      for (const [k, v] of inMemory) { if (v.resetAt < now) inMemory.delete(k); }
    }
    return entry.count;
  }

  return async function rateLimitMiddleware(req, res, next) {
    if (skipFn && skipFn(req)) return next();

    const identifier = keyFn ? keyFn(req) : (req.ip || "unknown");
    const key = `rl:${namespace}:${identifier}`;

    try {
      let count;
      const redis = getRedisClient();

      if (redis && isRedisConnected()) {
        const windowKey = `${key}:${Math.floor(Date.now() / windowMs)}`;
        count = await redis.incr(windowKey);
        // Set TTL only on first request in the window to avoid resetting it.
        if (count === 1) await redis.expire(windowKey, Math.ceil(windowMs / 1000) + 1);
      } else {
        // In production, warn loudly that Redis is unavailable.
        if (process.env.NODE_ENV === "production") {
          console.warn(`[ratelimit] Redis unavailable — using in-memory fallback for namespace=${namespace}`);
        }
        count = inMemoryCheck(key);
      }

      if (count > max) {
        return res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
          },
        });
      }

      next();
    } catch (err) {
      // If Redis throws unexpectedly, degrade gracefully rather than blocking the request.
      console.warn("[ratelimit] error, skipping limit:", err.message);
      next();
    }
  };
}

module.exports = { createRateLimiter };

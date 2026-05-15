import Redis from "ioredis";
import logger from "./logger.js";

let client = null;
let isConnected = false;

export function createRedisClient(url) {
  if (client) return client;

  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
  });

  client.on("connect", () => {
    isConnected = true;
    logger.info("Redis connected");
  });

  client.on("error", (err) => {
    isConnected = false;
    logger.warn({ err: err.message }, "Redis error — rate limiting falls back to in-memory");
  });

  client.on("close", () => {
    isConnected = false;
  });

  return client;
}

export function getRedisClient() {
  return client;
}

export function isRedisConnected() {
  return isConnected;
}

export async function connectRedis(url) {
  const c = createRedisClient(url);
  try {
    await c.connect();
  } catch (err) {
    // Non-fatal — app runs without Redis in dev
    logger.warn({ err: err.message }, "Redis unavailable at startup");
  }
  return c;
}

export async function disconnectRedis() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
    isConnected = false;
  }
}

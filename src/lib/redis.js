"use strict";
const Redis = require("ioredis");

let client = null;
let connected = false;

function createRedisClient(url) {
  if (client) return client;
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });
  client.on("connect", () => { connected = true; console.log("[redis] connected"); });
  client.on("error", (err) => { connected = false; console.warn("[redis] error —", err.message); });
  client.on("close", () => { connected = false; });
  return client;
}

function getRedisClient() { return client; }
function isRedisConnected() { return connected; }

async function connectRedis(url) {
  const c = createRedisClient(url);
  try { await c.connect(); } catch (err) {
    console.warn("[redis] unavailable at startup:", err.message);
  }
  return c;
}

async function disconnectRedis() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
    connected = false;
  }
}

module.exports = { createRedisClient, getRedisClient, isRedisConnected, connectRedis, disconnectRedis };

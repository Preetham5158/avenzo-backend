const crypto = require("crypto");

function hashIp(value) {
  if (!value) return null;
  const secret = process.env.JWT_SECRET || "avenzo-local";
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

async function logOrderAttempt(prisma, { restaurantId, phone, deviceId, ipHash, status, reason }) {
  try {
    await prisma.orderAttempt.create({
      data: {
        restaurantId: restaurantId || null,
        phone: phone || null,
        deviceId: deviceId || null,
        ipHash: ipHash || null,
        status,
        reason: reason || null
      }
    });
  } catch (err) {
    console.error(`[order-attempt:log-failed] ${err?.message || err}`);
  }
}

async function checkOrderAbuse(prisma, { restaurantId, phone, deviceId, ipHash }) {
  // Block lists and short-window attempt counts protect restaurants from noisy fake orders.
  const [blockedPhone, blockedDevice] = await Promise.all([
    phone ? prisma.blockedPhone.findUnique({ where: { phone } }) : null,
    deviceId ? prisma.blockedDevice.findUnique({ where: { deviceId } }) : null
  ]);

  if (blockedPhone) {
    return { allowed: false, reason: "This phone number cannot place orders right now." };
  }

  if (blockedDevice) {
    return { allowed: false, reason: "This device cannot place orders right now." };
  }

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const [phoneAttempts, deviceAttempts] = await Promise.all([
    phone
      ? prisma.orderAttempt.count({
          where: { restaurantId, phone, createdAt: { gte: since } }
        })
      : 0,
    deviceId
      ? prisma.orderAttempt.count({
          where: { restaurantId, deviceId, createdAt: { gte: since } }
        })
      : 0
  ]);

  if (phoneAttempts >= 5 || deviceAttempts >= 8) {
    await logOrderAttempt(prisma, {
      restaurantId,
      phone,
      deviceId,
      ipHash,
      status: "REJECTED",
      reason: "too_many_attempts"
    });
    return { allowed: false, reason: "Too many order attempts. Please wait a few minutes and try again." };
  }

  return { allowed: true };
}

module.exports = {
  checkOrderAbuse,
  hashIp,
  logOrderAttempt
};

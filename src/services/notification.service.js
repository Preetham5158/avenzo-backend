function paiseToRupees(value) {
  return Number(value || 0) / 100;
}

function maskEmail(value) {
  if (!value) return null;
  const [name, domain] = String(value).split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(value) {
  if (!value) return null;
  const text = String(value);
  return `${"*".repeat(Math.max(text.length - 4, 0))}${text.slice(-4)}`;
}

function safeLogEnabled() {
  return (process.env.OTP_MODE || process.env.NOTIFICATION_MODE || "log") === "log" && process.env.NODE_ENV !== "production";
}

async function sendOtp({ prisma, userId, channel = "LOG", phone, email, purpose, otp }) {
  const mode = process.env.OTP_MODE || "log";
  const recipientMasked = channel === "SMS" ? maskPhone(phone) : maskEmail(email);

  if (mode !== "log") {
    await prisma.notificationLog.create({
      data: {
        userId: userId || null,
        recipientPhone: phone || null,
        recipientEmail: email || null,
        recipientMasked,
        purpose,
        channel: channel === "SMS" ? "SMS" : "EMAIL",
        status: "SKIPPED",
        error: `OTP mode ${mode} is not configured yet`
      }
    });
    throw new Error("OTP delivery provider is not configured");
  }

  if (!safeLogEnabled()) {
    throw new Error("OTP log mode is disabled in production");
  }

  console.log(`[otp:dev-log] purpose=${purpose} recipient=${recipientMasked} otp=${otp}`);
  await prisma.notificationLog.create({
    data: {
      userId: userId || null,
      recipientPhone: phone || null,
      recipientEmail: email || null,
      recipientMasked,
      purpose,
      channel: "LOG",
      status: "LOGGED"
    }
  });
}

async function notifyOrderConfirmation({ prisma, order, restaurant, baseUrl, recipientEmail }) {
  const mode = process.env.NOTIFICATION_MODE || "log";
  const trackingUrl = `${baseUrl}/track/${order.trackingToken}`;
  const message = [
    `Order #${order.orderNumber} confirmed at ${restaurant?.name || "Avenzo"}.`,
    `Pickup code: ${order.pickupCode}.`,
    `Track: ${trackingUrl}.`,
    `Total: INR ${paiseToRupees(order.totalPricePaise)}.`
  ].join(" ");

  try {
    if (mode !== "log") {
      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientPhone: order.phone || null,
          recipientEmail: recipientEmail || null,
          recipientMasked: recipientEmail ? maskEmail(recipientEmail) : maskPhone(order.phone),
          purpose: "ORDER_CONFIRMATION",
          channel: "LOG",
          status: "SKIPPED",
          error: `Notification mode ${mode} is not configured yet`
        }
      });
      return;
    }

    console.log(`[notification:intent] order=${order.orderNumber} channel=log ${message}`);
    await prisma.notificationLog.create({
      data: {
        orderId: order.id,
        recipientPhone: order.phone || null,
        recipientEmail: recipientEmail || null,
        recipientMasked: recipientEmail ? maskEmail(recipientEmail) : maskPhone(order.phone),
        purpose: "ORDER_CONFIRMATION",
        channel: "LOG",
        status: "LOGGED"
      }
    });
  } catch (err) {
    console.error(`[notification:failed] ${err?.message || err}`);
    try {
      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientPhone: order.phone || null,
          recipientEmail: recipientEmail || null,
          recipientMasked: recipientEmail ? maskEmail(recipientEmail) : maskPhone(order.phone),
          purpose: "ORDER_CONFIRMATION",
          channel: "LOG",
          status: "FAILED",
          error: String(err?.message || err).slice(0, 500)
        }
      });
    } catch (logErr) {
      console.error(`[notification:log-failed] ${logErr?.message || logErr}`);
    }
  }
}

module.exports = {
  sendOtp,
  notifyOrderConfirmation
};

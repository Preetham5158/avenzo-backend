function paiseToRupees(value) {
  return Number(value || 0) / 100;
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
  notifyOrderConfirmation
};

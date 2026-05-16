// Lazy-initialized Resend client — only created when email mode is active.
let _resend = null;

function getResendClient() {
  if (_resend) return _resend;
  const { Resend } = require("resend");
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function validateEmailConfig() {
  const missing = [];
  if (process.env.EMAIL_PROVIDER !== "resend") missing.push("EMAIL_PROVIDER=resend");
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!process.env.FROM_EMAIL) missing.push("FROM_EMAIL");
  if (missing.length) {
    console.error(`[notification:config] Missing required env vars: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

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

function otpEmailHtml(otp, ttlMinutes) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:40px 32px">
  <div style="font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:28px">AVENZO</div>
  <h2 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#111827">Your verification code</h2>
  <p style="color:#6b7280;margin:0 0 28px;font-size:15px;line-height:1.5">Use this code to complete your Avenzo sign in. It expires in ${ttlMinutes} minute${ttlMinutes !== 1 ? "s" : ""}.</p>
  <div style="font-size:42px;font-weight:800;letter-spacing:8px;text-align:center;padding:28px 16px;background:#f9fafb;border-radius:10px;color:#111827;margin-bottom:28px">${otp}</div>
  <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.5">If you did not request this code, you can safely ignore this email. Your account will not be affected.</p>
</div>
</body>
</html>`;
}

function orderConfirmationHtml({ restaurantName, pickupCode, orderNumber, total, trackingUrl }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:40px 32px">
  <div style="font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:28px">AVENZO</div>
  <h2 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#111827">Order confirmed</h2>
  <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.5">Your order at <strong style="color:#111827">${restaurantName}</strong> has been placed.</p>
  <div style="background:#f9fafb;border-radius:10px;padding:20px 24px;margin-bottom:24px">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <span style="color:#6b7280;font-size:14px">Order</span>
      <span style="font-weight:600;color:#111827">#${orderNumber}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <span style="color:#6b7280;font-size:14px">Pickup code</span>
      <span style="font-size:20px;font-weight:800;letter-spacing:3px;color:#111827">${pickupCode}</span>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#6b7280;font-size:14px">Total</span>
      <span style="font-weight:600;color:#111827">Rs ${total}</span>
    </div>
  </div>
  <a href="${trackingUrl}" style="display:block;background:#111827;color:#fff;text-align:center;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px">Track your order</a>
  <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.5">Show the pickup code to the restaurant when collecting your order.</p>
</div>
</body>
</html>`;
}

function orderStatusHtml({ restaurantName, pickupCode, orderNumber, status, trackingUrl }) {
  const headings = { READY: "Your order is ready", CANCELLED: "Order cancelled", COMPLETED: "Order completed" };
  const bodies = {
    READY: `Your order at <strong style="color:#111827">${restaurantName}</strong> is ready for collection. Please collect at the counter.`,
    CANCELLED: `Your order #${orderNumber} at <strong style="color:#111827">${restaurantName}</strong> has been cancelled. If you have questions, contact support.`,
    COMPLETED: `Your order at <strong style="color:#111827">${restaurantName}</strong> is complete. Thank you for dining with us.`
  };
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:40px 32px">
  <div style="font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:28px">AVENZO</div>
  <h2 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#111827">${headings[status] || "Order update"}</h2>
  <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.5">${bodies[status] || ""}</p>
  <div style="background:#f9fafb;border-radius:10px;padding:20px 24px;margin-bottom:24px">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <span style="color:#6b7280;font-size:14px">Order</span>
      <span style="font-weight:600;color:#111827">#${orderNumber}</span>
    </div>
    ${status === "READY" ? `<div style="display:flex;justify-content:space-between">
      <span style="color:#6b7280;font-size:14px">Pickup code</span>
      <span style="font-size:20px;font-weight:800;letter-spacing:3px;color:#111827">${pickupCode}</span>
    </div>` : ""}
  </div>
  <a href="${trackingUrl}" style="display:block;background:#111827;color:#fff;text-align:center;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px">View order</a>
</div>
</body>
</html>`;
}

async function sendOtp({ prisma, userId, channel = "LOG", phone, email, purpose, otp }) {
  const mode = process.env.OTP_MODE || "log";
  const recipientMasked = channel === "SMS" ? maskPhone(phone) : maskEmail(email);
  const ttlMinutes = Math.max(parseInt(process.env.OTP_TTL_MINUTES || "10", 10), 1);

  if (mode === "email") {
    if (!validateEmailConfig()) {
      await prisma.notificationLog.create({
        data: {
          userId: userId || null,
          recipientEmail: email || null,
          recipientMasked,
          purpose,
          channel: "EMAIL",
          status: "FAILED",
          error: "Email provider not configured"
        }
      });
      throw new Error("We could not send the verification code. Please contact support.");
    }

    if (!email) {
      await prisma.notificationLog.create({
        data: {
          userId: userId || null,
          recipientMasked: "no-email",
          purpose,
          channel: "EMAIL",
          status: "FAILED",
          error: "No email address on account"
        }
      });
      throw new Error("No email address is associated with this account. Please contact support.");
    }

    try {
      const resend = getResendClient();
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: "Your Avenzo verification code",
        html: otpEmailHtml(otp, ttlMinutes)
      });

      if (error) {
        console.error(`[otp:send-failed] masked=${recipientMasked} purpose=${purpose} provider_code=${error.name}`);
        await prisma.notificationLog.create({
          data: {
            userId: userId || null,
            recipientEmail: email || null,
            recipientMasked,
            purpose,
            channel: "EMAIL",
            status: "FAILED",
            error: String(error.name || "send_error").slice(0, 200)
          }
        });
        throw new Error("We could not send the verification code. Please try again.");
      }

      await prisma.notificationLog.create({
        data: {
          userId: userId || null,
          recipientEmail: email || null,
          recipientMasked,
          purpose,
          channel: "EMAIL",
          status: "LOGGED"
        }
      });
      return;
    } catch (err) {
      if (err.message && err.message.startsWith("We could not")) throw err;
      console.error(`[otp:send-error] masked=${recipientMasked} purpose=${purpose} msg=${err.message}`);
      await prisma.notificationLog.create({
        data: {
          userId: userId || null,
          recipientEmail: email || null,
          recipientMasked,
          purpose,
          channel: "EMAIL",
          status: "FAILED",
          error: String(err.message || "unknown").slice(0, 200)
        }
      }).catch(() => {});
      throw new Error("We could not send the verification code. Please try again.");
    }
  }

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
        error: `OTP mode "${mode}" is not configured`
      }
    });
    throw new Error("Verification could not be sent. Please try again or contact support.");
  }

  // Development log mode — never print OTP in production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("OTP log mode is disabled in production. Configure EMAIL_PROVIDER=resend.");
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

  if (mode === "email") {
    if (!recipientEmail) return; // Guest order with no email — skip silently.
    if (!validateEmailConfig()) {
      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientEmail: recipientEmail || null,
          recipientMasked: maskEmail(recipientEmail),
          purpose: "ORDER_CONFIRMATION",
          channel: "EMAIL",
          status: "FAILED",
          error: "Email provider not configured"
        }
      }).catch(() => {});
      return;
    }

    try {
      const resend = getResendClient();
      const total = paiseToRupees(order.totalPricePaise).toFixed(2);
      const trackingUrl = `${baseUrl}/track/${order.trackingToken}`;
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: recipientEmail,
        subject: `Order confirmed — ${restaurant?.name || "Avenzo"}`,
        html: orderConfirmationHtml({
          restaurantName: restaurant?.name || "the restaurant",
          pickupCode: order.pickupCode,
          orderNumber: order.orderNumber,
          total,
          trackingUrl
        })
      });

      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientEmail: recipientEmail || null,
          recipientMasked: maskEmail(recipientEmail),
          purpose: "ORDER_CONFIRMATION",
          channel: "EMAIL",
          status: error ? "FAILED" : "LOGGED",
          error: error ? String(error.name || "send_error").slice(0, 200) : null
        }
      }).catch(() => {});

      if (error) {
        console.error(`[notification:order-confirm-failed] order=${order.orderNumber} code=${error.name}`);
      }
    } catch (err) {
      console.error(`[notification:order-confirm-error] order=${order.orderNumber} msg=${err.message}`);
      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientEmail: recipientEmail || null,
          recipientMasked: maskEmail(recipientEmail),
          purpose: "ORDER_CONFIRMATION",
          channel: "EMAIL",
          status: "FAILED",
          error: String(err.message || "unknown").slice(0, 200)
        }
      }).catch(() => {});
    }
    return;
  }

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
        error: `Notification mode "${mode}" is not configured`
      }
    }).catch(() => {});
    return;
  }

  // log mode — best-effort
  try {
    console.log(`[notification:order-confirm] order=${order.orderNumber} channel=log`);
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
    console.error(`[notification:order-confirm-log-failed] ${err?.message || err}`);
  }
}

// Sends a status update email for READY, CANCELLED, or COMPLETED orders.
// Order creation must NOT fail if this throws — callers should .catch() it.
async function notifyOrderStatus({ prisma, order, restaurant, status, baseUrl, recipientEmail }) {
  const mode = process.env.NOTIFICATION_MODE || "log";
  const notifiableStatuses = ["READY", "CANCELLED", "COMPLETED"];
  if (!notifiableStatuses.includes(status)) return;
  if (!recipientEmail) return;

  if (mode === "email") {
    if (!validateEmailConfig()) return;
    try {
      const resend = getResendClient();
      const trackingUrl = `${baseUrl}/track/${order.trackingToken}`;
      const subjects = {
        READY: `Your order is ready — ${restaurant?.name || "Avenzo"}`,
        CANCELLED: `Order cancelled — ${restaurant?.name || "Avenzo"}`,
        COMPLETED: `Order complete — ${restaurant?.name || "Avenzo"}`
      };
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: recipientEmail,
        subject: subjects[status],
        html: orderStatusHtml({
          restaurantName: restaurant?.name || "the restaurant",
          pickupCode: order.pickupCode,
          orderNumber: order.orderNumber,
          status,
          trackingUrl
        })
      });

      await prisma.notificationLog.create({
        data: {
          orderId: order.id,
          recipientEmail: recipientEmail || null,
          recipientMasked: maskEmail(recipientEmail),
          purpose: `ORDER_STATUS_${status}`,
          channel: "EMAIL",
          status: error ? "FAILED" : "LOGGED",
          error: error ? String(error.name || "send_error").slice(0, 200) : null
        }
      }).catch(() => {});
    } catch (err) {
      console.error(`[notification:order-status-error] order=${order.orderNumber} status=${status} msg=${err.message}`);
    }
    return;
  }

  if (mode === "log" && process.env.NODE_ENV !== "production") {
    console.log(`[notification:order-status] order=${order.orderNumber} status=${status} channel=log`);
  }
}

module.exports = {
  sendOtp,
  maskEmail,
  notifyOrderConfirmation,
  notifyOrderStatus
};

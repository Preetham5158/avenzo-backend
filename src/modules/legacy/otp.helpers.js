"use strict";
/**
 * OTP helpers for legacy auth routes.
 * Shared between auth.legacy.routes.js and reused by password reset flow.
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { createPrismaClient } = require("../../prisma");
const { sendOtp, maskEmail } = require("../../services/notification.service");
const { logRouteError } = require("../../lib/helpers");

const prisma = createPrismaClient();

function otpTtlMinutes() {
    return Math.max(parseInt(process.env.OTP_TTL_MINUTES || "10", 10), 1);
}

function otpMaxAttempts() {
    return Math.min(Math.max(parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10), 1), 10);
}

function generateOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function hashOtp(value) {
    return bcrypt.hash(String(value), 10);
}

function restaurant2faRequired() {
    return String(process.env.AUTH_REQUIRE_RESTAURANT_2FA || "false").toLowerCase() === "true";
}

function customer2faRequired() {
    return String(process.env.AUTH_REQUIRE_CUSTOMER_2FA || "false").toLowerCase() === "true";
}

async function createOtpChallenge(user, purpose) {
    const otp = generateOtp();
    const otpMode = process.env.OTP_MODE || "log";
    // When email mode is active, always use EMAIL channel regardless of whether a phone exists.
    const channel = otpMode === "email"
        ? (user.email ? "EMAIL" : "LOG")
        : otpMode === "log"
            ? "LOG"
            : (user.phone ? "SMS" : user.email ? "EMAIL" : "LOG");

    const challenge = await prisma.otpChallenge.create({
        data: {
            userId: user.id,
            email: user.email || null,
            phone: user.phone || null,
            purpose,
            channel,
            otpHash: await hashOtp(otp),
            expiresAt: new Date(Date.now() + otpTtlMinutes() * 60 * 1000),
            maxAttempts: otpMaxAttempts(),
            metadata: { role: user.role }
        },
        select: { id: true, expiresAt: true, channel: true }
    });

    try {
        await sendOtp({
            prisma,
            userId: user.id,
            channel,
            phone: user.phone,
            email: user.email,
            purpose,
            otp
        });
    } catch (err) {
        logRouteError("sendOtp", err);
        throw new Error("We could not send the verification code. Please try again in a moment.");
    }

    return { ...challenge, maskedEmail: maskEmail(user.email) };
}

module.exports = {
    otpTtlMinutes,
    otpMaxAttempts,
    generateOtp,
    hashOtp,
    restaurant2faRequired,
    customer2faRequired,
    createOtpChallenge,
    maskEmail
};

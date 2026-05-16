"use strict";
// webCompat routes — serve current static apps/api/public/ HTML frontend during migration to Next.js apps. New clients must use /api/v1 exclusively.

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");

const { createPrismaClient } = require("../../prisma");
const { cleanString, isValidEmail, logRouteError } = require("../../lib/helpers");
const { normalizePhone } = require("../../utils/phone");
const { isValidPhone } = require("../../utils/phone");
const { authLimiter, otpLimiter, passwordResetLimiter } = require("../../config/rateLimiters");
const { authMiddleware } = require("../../middlewares/auth.middleware");
const {
    signAuthToken,
    loginSuccessResponse,
    findPasswordUser,
} = require("../../services/auth.service");
const {
    restaurant2faRequired,
    customer2faRequired,
    createOtpChallenge,
    generateOtp,
    hashOtp,
} = require("./otp.helpers");
const { sendOtp, maskEmail } = require("../../services/notification.service");

const prisma = createPrismaClient();
const router = express.Router();

router.post("/auth/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "Use a valid email and at least 8 characters for password" });
        }
        const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
        if (existing) return res.status(400).json({ error: "User already exists" });
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.create({
            data: { email: String(email).toLowerCase().trim(), password: hashed, name }
        });
        res.json({ message: "Customer account created" });
    } catch (err) {
        logRouteError("POST /auth/signup", err);
        res.status(500).json({ error: "Signup failed" });
    }
});

router.post("/auth/customer/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "Use a valid email and at least 8 characters for password" });
        }
        const normalizedEmail = String(email).toLowerCase().trim();
        const normalizedPhone = phone ? normalizePhone(phone) : null;
        if (normalizedPhone && !isValidPhone(normalizedPhone)) {
            return res.status(400).json({ error: "Use a valid phone number" });
        }
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(400).json({ error: "User already exists" });
        await prisma.user.create({
            data: {
                email: normalizedEmail,
                password: await bcrypt.hash(password, 10),
                name: cleanString(name, 120),
                phone: normalizedPhone
            }
        });
        res.json({ message: "Customer account created" });
    } catch (err) {
        logRouteError("POST /auth/customer/signup", err);
        res.status(500).json({ error: "Signup failed" });
    }
});

router.post("/auth/customer/login", authLimiter, async (req, res) => {
    try {
        const user = await findPasswordUser(req.body.email, req.body.password);
        if (!user) return res.status(400).json({ error: "Invalid credentials" });
        if (user.role !== "USER") {
            return res.status(403).json({ error: "This sign in is for customer accounts. Restaurant partners should use restaurant login." });
        }
        if (customer2faRequired()) {
            const challenge = await createOtpChallenge(user, "CUSTOMER_LOGIN");
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                maskedEmail: challenge.maskedEmail,
                expiresAt: challenge.expiresAt
            });
        }
        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/customer/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

// Exposes only the public Google client ID — safe to return to any visitor.
router.get("/auth/google/client-id", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID || null;
    res.json({ clientId });
});

// Google SSO — customer accounts only. ADMIN/RESTAURANT_OWNER creation is never allowed here.
router.post("/auth/google", authLimiter, async (req, res) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) return res.status(503).json({ error: "Google sign-in is not configured" });
        const idToken = cleanString(req.body.idToken, 4096);
        if (!idToken) return res.status(400).json({ error: "idToken required" });

        const client = new OAuth2Client(clientId);
        let payload;
        try {
            const ticket = await client.verifyIdToken({ idToken, audience: clientId });
            payload = ticket.getPayload();
        } catch {
            return res.status(401).json({ error: "Invalid Google token" });
        }

        const { email, name, email_verified } = payload;
        if (!email || !email_verified) return res.status(400).json({ error: "Google account email is not verified" });

        const normalizedEmail = email.toLowerCase().trim();
        let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (user) {
            // Block non-customer accounts from using this SSO path
            if (user.role !== "USER") {
                return res.status(403).json({ error: "This sign-in is for customer accounts only." });
            }
            // Stamp emailVerifiedAt if not already set
            if (!user.emailVerifiedAt) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { emailVerifiedAt: new Date() }
                });
            }
        } else {
            // Create new customer account via Google
            user = await prisma.user.create({
                data: {
                    email: normalizedEmail,
                    // Random unusable password — Google users authenticate via token, not password
                    password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
                    name: cleanString(name, 120) || null,
                    role: "USER",
                    emailVerifiedAt: new Date()
                }
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/google", err);
        res.status(500).json({ error: "Google sign-in failed" });
    }
});

router.post("/auth/restaurant/login", authLimiter, async (req, res) => {
    try {
        const user = await findPasswordUser(req.body.email, req.body.password);
        if (!user) return res.status(400).json({ error: "Invalid credentials" });
        // Restaurant partner login is only for approved admin, owner, and employee accounts.
        if (user.role === "USER") {
            return res.status(403).json({ error: "This is a customer account. Restaurant access is available only for approved Avenzo partners." });
        }
        if (restaurant2faRequired()) {
            const challenge = await createOtpChallenge(user, "RESTAURANT_LOGIN");
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                maskedEmail: challenge.maskedEmail,
                expiresAt: challenge.expiresAt
            });
        }
        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/restaurant/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

router.post("/auth/otp/verify", otpLimiter, async (req, res) => {
    try {
        const { challengeId, otp, purpose } = req.body;
        if (!challengeId || !otp) return res.status(400).json({ error: "OTP required" });

        const challenge = await prisma.otpChallenge.findUnique({
            where: { id: String(challengeId) },
            include: { user: true }
        });

        if (!challenge || !challenge.user) return res.status(400).json({ error: "Invalid or expired OTP" });
        if (purpose && challenge.purpose !== purpose) return res.status(400).json({ error: "Invalid or expired OTP" });
        if (challenge.consumedAt) return res.status(400).json({ error: "OTP already used" });
        if (challenge.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
        if (challenge.attempts >= challenge.maxAttempts) return res.status(429).json({ error: "Too many OTP attempts" });

        const valid = await bcrypt.compare(String(otp), challenge.otpHash);
        if (!valid) {
            await prisma.otpChallenge.update({
                where: { id: challenge.id },
                data: { attempts: { increment: 1 } }
            });
            return res.status(400).json({ error: "Invalid OTP" });
        }

        await prisma.otpChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: new Date() }
        });

        res.json(loginSuccessResponse(challenge.user));
    } catch (err) {
        logRouteError("POST /auth/otp/verify", err);
        res.status(500).json({ error: "OTP verification failed" });
    }
});

router.post("/auth/otp/resend", otpLimiter, async (req, res) => {
    try {
        const { challengeId } = req.body;
        if (!challengeId) return res.status(400).json({ error: "Challenge required" });

        const current = await prisma.otpChallenge.findUnique({
            where: { id: String(challengeId) },
            include: { user: true }
        });

        if (!current || !current.user || current.consumedAt) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        await prisma.otpChallenge.update({
            where: { id: current.id },
            data: { consumedAt: new Date() }
        });

        const challenge = await createOtpChallenge(current.user, current.purpose);
        res.json({
            otpRequired: true,
            challengeId: challenge.id,
            channel: challenge.channel,
            maskedEmail: challenge.maskedEmail,
            expiresAt: challenge.expiresAt
        });
    } catch (err) {
        logRouteError("POST /auth/otp/resend", err);
        res.status(500).json({ error: "Could not resend OTP" });
    }
});

router.post("/auth/password-reset/request", passwordResetLimiter, async (req, res) => {
    try {
        const email = cleanString(req.body.email, 180)?.toLowerCase().trim();
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: "Enter a valid email address" });
        }

        // Always respond the same way to prevent email enumeration.
        const safeResponse = { message: "If this email is registered to a customer account, a verification code was sent." };
        const genericResponse = () => ({
            challengeId: crypto.randomUUID(),
            maskedEmail: maskEmail(email),
            ...safeResponse
        });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.role !== "USER") return res.json(genericResponse());

        const otp = generateOtp();
        const channel = process.env.OTP_MODE === "email" ? "EMAIL" : "LOG";
        const challenge = await prisma.otpChallenge.create({
            data: {
                userId: user.id,
                email: user.email,
                purpose: "PASSWORD_RESET",
                channel,
                otpHash: await hashOtp(otp),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000),
                maxAttempts: 3
            },
            select: { id: true }
        });

        await sendOtp({ prisma, userId: user.id, channel, email: user.email, purpose: "PASSWORD_RESET", otp });

        res.json({ challengeId: challenge.id, maskedEmail: maskEmail(user.email), ...safeResponse });
    } catch (err) {
        logRouteError("POST /auth/password-reset/request", err);
        res.status(500).json({ error: "We could not process this request. Please try again." });
    }
});

router.post("/auth/password-reset/confirm", passwordResetLimiter, async (req, res) => {
    try {
        const challengeId = cleanString(req.body.challengeId, 80);
        const otp = cleanString(req.body.otp, 10);
        const newPassword = req.body.newPassword;

        if (!challengeId || !otp || !newPassword) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        if (typeof newPassword !== "string" || newPassword.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });

        if (!challenge || challenge.purpose !== "PASSWORD_RESET") {
            return res.status(400).json({ error: "Invalid or expired reset code" });
        }
        if (challenge.consumedAt) return res.status(400).json({ error: "This code has already been used" });
        if (challenge.expiresAt < new Date()) return res.status(400).json({ error: "This code has expired. Please request a new one." });
        if (challenge.attempts >= challenge.maxAttempts) {
            return res.status(429).json({ error: "Too many attempts. Please request a new reset code." });
        }

        await prisma.otpChallenge.update({
            where: { id: challengeId },
            data: { attempts: { increment: 1 } }
        });

        const valid = await bcrypt.compare(String(otp), challenge.otpHash);
        if (!valid) {
            return res.status(400).json({ error: "That code doesn't look right. Please try again." });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.$transaction([
            prisma.otpChallenge.update({ where: { id: challengeId }, data: { consumedAt: new Date() } }),
            prisma.user.update({ where: { id: challenge.userId }, data: { password: hashed } })
        ]);

        res.json({ message: "Password updated. You can now sign in with your new password." });
    } catch (err) {
        logRouteError("POST /auth/password-reset/confirm", err);
        res.status(500).json({ error: "Could not reset password. Please try again." });
    }
});

router.post("/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email & password required" });

        const user = await findPasswordUser(email, password);
        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        const requiresOtp = user.role === "USER" ? customer2faRequired() : restaurant2faRequired();
        if (requiresOtp) {
            const purpose = user.role === "USER" ? "CUSTOMER_LOGIN" : "RESTAURANT_LOGIN";
            const challenge = await createOtpChallenge(user, purpose);
            return res.json({
                otpRequired: true,
                challengeId: challenge.id,
                channel: challenge.channel,
                maskedEmail: challenge.maskedEmail,
                expiresAt: challenge.expiresAt
            });
        }

        res.json(loginSuccessResponse(user));
    } catch (err) {
        logRouteError("POST /auth/login", err);
        res.status(500).json({ error: "Login failed" });
    }
});

router.get("/auth/me", authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, name: true, phone: true, role: true }
        });
        res.json(user);
    } catch (err) {
        logRouteError("GET /auth/me", err);
        res.status(500).json({ error: "Error fetching account" });
    }
});

module.exports = router;

"use strict";
const { z } = require("zod");
require("dotenv").config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  APP_BASE_URL: z.string().default("http://localhost:5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_CURRENCY: z.string().default("INR"),

  GOOGLE_CLIENT_ID: z.string().optional(),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  OTP_MODE: z.enum(["log", "email"]).default("log"),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

  AUTH_REQUIRE_RESTAURANT_2FA: z.string().transform(v => v === "true").default("false"),
  AUTH_REQUIRE_CUSTOMER_2FA: z.string().transform(v => v === "true").default("false"),

  NOTIFICATION_MODE: z.enum(["log", "email"]).default("log"),

  EMAIL_PROVIDER: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  SUPPORT_EMAIL: z.string().optional(),

  CORS_ORIGINS: z.string().default("http://localhost:5000,http://localhost:3000"),

  SENTRY_DSN: z.string().optional(),

  ENABLE_BOOTSTRAP_SCHEMA: z.string().transform(v => v === "true").default("false"),
});

function productionChecks(parsed) {
  if (parsed.NODE_ENV !== "production") return;
  const errors = [];
  if (!parsed.RAZORPAY_KEY_ID || parsed.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
    errors.push("RAZORPAY_KEY_ID must be a live key in production");
  }
  if (!parsed.RAZORPAY_KEY_SECRET) errors.push("RAZORPAY_KEY_SECRET is required in production");
  if (!parsed.RAZORPAY_WEBHOOK_SECRET) errors.push("RAZORPAY_WEBHOOK_SECRET is required in production");
  if (parsed.OTP_MODE === "log") errors.push("OTP_MODE=log is not allowed in production");
  if (parsed.JWT_SECRET.includes("replace-with")) errors.push("JWT_SECRET must not be the placeholder value in production");
  if (errors.length > 0) {
    console.error("[env] Production config errors:");
    errors.forEach(e => console.error("  -", e));
    process.exit(1);
  }
}

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error("[env] Invalid environment variables:");
  result.error.issues.forEach(issue => {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

productionChecks(result.data);

module.exports = { env: result.data };

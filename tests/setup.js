"use strict";
/**
 * Jest global test setup.
 * Sets required env vars before any module is loaded.
 */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-minimum-32-characters-for-testing-purposes";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test_avenzo";
process.env.DIRECT_URL = process.env.DIRECT_URL || "postgresql://test:test@localhost:5432/test_avenzo";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.PORT = "5001";
process.env.OTP_MODE = "log";
process.env.NOTIFICATION_MODE = "log";
process.env.RAZORPAY_KEY_ID = "rzp_test_testonly";
process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CORS_ORIGINS = "http://localhost:3000";

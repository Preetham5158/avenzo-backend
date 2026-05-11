CREATE TYPE "PaymentStatus" AS ENUM ('PAYMENT_NOT_REQUIRED', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "NotificationStatus" AS ENUM ('LOGGED', 'SKIPPED', 'FAILED');
CREATE TYPE "NotificationChannel" AS ENUM ('LOG', 'EMAIL', 'SMS', 'WHATSAPP');
CREATE TYPE "OrderAttemptStatus" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TYPE "AuditAction" AS ENUM ('RESTAURANT_CREATED', 'RESTAURANT_UPDATED', 'SUBSCRIPTION_UPDATED', 'STAFF_ADDED', 'STAFF_REMOVED', 'ORDER_STATUS_UPDATED', 'ORDER_ATTEMPT_REJECTED');

ALTER TABLE "User" ADD COLUMN "phone" TEXT;

ALTER TABLE "Order" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAYMENT_NOT_REQUIRED';
UPDATE "Order" SET "phone" = 'UNKNOWN' WHERE "phone" IS NULL OR trim("phone") = '';
ALTER TABLE "Order" ALTER COLUMN "phone" SET NOT NULL;

ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderAttempt" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "phone" TEXT,
    "deviceId" TEXT,
    "ipHash" TEXT,
    "status" "OrderAttemptStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlockedPhone" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedPhone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlockedDevice" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "restaurantId" TEXT,
    "orderId" TEXT,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockedPhone_phone_key" ON "BlockedPhone"("phone");
CREATE UNIQUE INDEX "BlockedDevice_deviceId_key" ON "BlockedDevice"("deviceId");

CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_phone_idx" ON "Order"("phone");
CREATE INDEX "NotificationLog_orderId_idx" ON "NotificationLog"("orderId");
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
CREATE INDEX "OrderAttempt_restaurantId_idx" ON "OrderAttempt"("restaurantId");
CREATE INDEX "OrderAttempt_phone_idx" ON "OrderAttempt"("phone");
CREATE INDEX "OrderAttempt_deviceId_idx" ON "OrderAttempt"("deviceId");
CREATE INDEX "OrderAttempt_createdAt_idx" ON "OrderAttempt"("createdAt");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX "AuditLog_restaurantId_idx" ON "AuditLog"("restaurantId");
CREATE INDEX "AuditLog_orderId_idx" ON "AuditLog"("orderId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

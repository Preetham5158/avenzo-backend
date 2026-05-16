ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';

CREATE TYPE "OtpPurpose" AS ENUM ('CUSTOMER_LOGIN', 'RESTAURANT_LOGIN', 'SIGNUP_VERIFY', 'ORDER_CONFIRMATION', 'PASSWORD_RESET');
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS', 'LOG');

ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "RestaurantLead" ADD COLUMN "internalNote" TEXT;
ALTER TABLE "RestaurantLead" ADD COLUMN "viewedAt" TIMESTAMP(3);

ALTER TABLE "NotificationLog" ADD COLUMN "userId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "recipientMasked" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "purpose" TEXT;

CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantLead_viewedAt_idx" ON "RestaurantLead"("viewedAt");
CREATE INDEX "OtpChallenge_userId_idx" ON "OtpChallenge"("userId");
CREATE INDEX "OtpChallenge_email_idx" ON "OtpChallenge"("email");
CREATE INDEX "OtpChallenge_phone_idx" ON "OtpChallenge"("phone");
CREATE INDEX "OtpChallenge_purpose_idx" ON "OtpChallenge"("purpose");
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

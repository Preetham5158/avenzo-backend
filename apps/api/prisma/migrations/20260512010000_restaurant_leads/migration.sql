CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');

CREATE TABLE "RestaurantLead" (
    "id" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "location" TEXT,
    "restaurantType" TEXT,
    "approxDailyOrders" TEXT,
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantLead_status_idx" ON "RestaurantLead"("status");
CREATE INDEX "RestaurantLead_createdAt_idx" ON "RestaurantLead"("createdAt");

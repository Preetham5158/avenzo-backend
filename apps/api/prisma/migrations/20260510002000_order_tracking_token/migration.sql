-- Add tracking token as nullable first so existing orders can be backfilled
ALTER TABLE "Order" ADD COLUMN "trackingToken" TEXT;

-- Backfill existing orders with random UUID tokens
UPDATE "Order"
SET "trackingToken" = gen_random_uuid()::TEXT
WHERE "trackingToken" IS NULL;

-- Make it required after backfill
ALTER TABLE "Order" ALTER COLUMN "trackingToken" SET NOT NULL;

-- Ensure tokens are unique
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");
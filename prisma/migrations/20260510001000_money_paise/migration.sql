-- Add new integer paise columns
ALTER TABLE "Menu" ADD COLUMN "pricePaise" INTEGER;
ALTER TABLE "Order" ADD COLUMN "totalPricePaise" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "priceAtOrderPaise" INTEGER;

-- Backfill existing data from rupees to paise
UPDATE "Menu"
SET "pricePaise" = ROUND("price" * 100)::INTEGER;

UPDATE "Order"
SET "totalPricePaise" = ROUND("totalPrice" * 100)::INTEGER;

UPDATE "OrderItem"
SET "priceAtOrderPaise" = ROUND("priceAtOrder" * 100)::INTEGER;

-- Make new columns required
ALTER TABLE "Menu" ALTER COLUMN "pricePaise" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "totalPricePaise" SET NOT NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "priceAtOrderPaise" SET NOT NULL;

-- Remove old float money columns
ALTER TABLE "Menu" DROP COLUMN "price";
ALTER TABLE "Order" DROP COLUMN "totalPrice";
ALTER TABLE "OrderItem" DROP COLUMN "priceAtOrder";
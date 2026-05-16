-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tableNumber" TEXT;

-- AlterTable
ALTER TABLE "OrderRating" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

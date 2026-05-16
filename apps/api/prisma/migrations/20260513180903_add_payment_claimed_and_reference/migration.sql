-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PAYMENT_CLAIMED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentReference" TEXT;

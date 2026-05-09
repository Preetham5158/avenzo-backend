-- CreateEnum
CREATE TYPE "FoodType" AS ENUM ('VEG', 'NON_VEG');

-- CreateEnum
CREATE TYPE "RestaurantFoodType" AS ENUM ('PURE_VEG', 'NON_VEG', 'BOTH');

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN "foodType" "RestaurantFoodType" NOT NULL DEFAULT 'BOTH';

-- AlterTable
ALTER TABLE "Menu" ADD COLUMN "foodType" "FoodType" NOT NULL DEFAULT 'VEG';

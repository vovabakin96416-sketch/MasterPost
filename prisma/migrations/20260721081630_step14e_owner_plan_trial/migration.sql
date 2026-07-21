-- CreateEnum
CREATE TYPE "OwnerPlan" AS ENUM ('trial', 'active');

-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "plan" "OwnerPlan" NOT NULL DEFAULT 'active',
ADD COLUMN     "trialUntil" TIMESTAMP(3);

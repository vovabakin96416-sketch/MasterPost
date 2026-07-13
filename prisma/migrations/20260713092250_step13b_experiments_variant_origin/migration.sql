-- CreateEnum
CREATE TYPE "PostOrigin" AS ENUM ('human', 'ai');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('active', 'stopped');

-- AlterTable
ALTER TABLE "PendingPost" ADD COLUMN     "variantKey" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "origin" "PostOrigin" NOT NULL DEFAULT 'human';

-- AlterTable
ALTER TABLE "PostMetric" ADD COLUMN     "origin" "PostOrigin" NOT NULL DEFAULT 'human',
ADD COLUMN     "variantKey" TEXT;

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'active',
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_channelId_status_idx" ON "Experiment"("channelId", "status");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

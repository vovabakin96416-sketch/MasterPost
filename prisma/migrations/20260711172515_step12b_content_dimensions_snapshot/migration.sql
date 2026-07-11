-- AlterTable
ALTER TABLE "PostMetric" ADD COLUMN     "charLen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hasButtons" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasMedia" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChannelStatSnapshot" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscribers" INTEGER,
    "postCount7d" INTEGER NOT NULL DEFAULT 0,
    "avgViews7d" INTEGER NOT NULL DEFAULT 0,
    "avgErr7d" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ChannelStatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelStatSnapshot_channelId_capturedAt_idx" ON "ChannelStatSnapshot"("channelId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ChannelStatSnapshot" ADD CONSTRAINT "ChannelStatSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

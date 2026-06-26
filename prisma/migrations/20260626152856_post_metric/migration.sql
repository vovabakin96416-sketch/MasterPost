-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "preview" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostMetric_channelId_postedAt_idx" ON "PostMetric"("channelId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostMetric_channelId_messageId_key" ON "PostMetric"("channelId", "messageId");

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

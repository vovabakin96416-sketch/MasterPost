-- CreateTable
CREATE TABLE "PendingPost" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" INTEGER,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingPost_channelId_createdAt_idx" ON "PendingPost"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "PendingPost" ADD CONSTRAINT "PendingPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

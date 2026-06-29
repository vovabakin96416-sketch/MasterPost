-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "oneOff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photoFileId" TEXT,
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Post_oneOff_publishedAt_publishAt_idx" ON "Post"("oneOff", "publishedAt", "publishAt");

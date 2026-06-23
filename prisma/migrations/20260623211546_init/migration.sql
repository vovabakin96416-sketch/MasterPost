-- CreateEnum
CREATE TYPE "InteractiveType" AS ENUM ('keyword_trigger', 'button_choice', 'button_prediction', 'vote_123');

-- CreateEnum
CREATE TYPE "Slot" AS ENUM ('morning', 'evening');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "niche" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ru',
    "region" TEXT,
    "goal" TEXT,
    "toneOfVoice" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "campaignStart" TIMESTAMP(3),
    "triggerWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "day" "Weekday" NOT NULL,
    "slot" "Slot" NOT NULL,
    "time" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "interactiveType" "InteractiveType" NOT NULL,
    "keyword" TEXT,
    "reactions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "choices" JSONB,
    "button" JSONB,
    "pexelsQuery" TEXT,
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextPool" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "texts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooldown" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cooldown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_username_key" ON "Channel"("username");

-- CreateIndex
CREATE INDEX "Post_channelId_week_day_slot_idx" ON "Post"("channelId", "week", "day", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Post_channelId_externalId_key" ON "Post"("channelId", "externalId");

-- CreateIndex
CREATE INDEX "TextPool_channelId_idx" ON "TextPool"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "TextPool_channelId_key_key" ON "TextPool"("channelId", "key");

-- CreateIndex
CREATE INDEX "Setting_channelId_idx" ON "Setting"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_channelId_key_key" ON "Setting"("channelId", "key");

-- CreateIndex
CREATE INDEX "Cooldown_channelId_expiresAt_idx" ON "Cooldown"("channelId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cooldown_channelId_userId_trigger_key" ON "Cooldown"("channelId", "userId", "trigger");

-- CreateIndex
CREATE INDEX "Subscriber_channelId_idx" ON "Subscriber"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_channelId_userId_key" ON "Subscriber"("channelId", "userId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextPool" ADD CONSTRAINT "TextPool_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cooldown" ADD CONSTRAINT "Cooldown_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

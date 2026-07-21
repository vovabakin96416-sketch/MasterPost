-- CreateTable
CREATE TABLE "BotAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotAccount_ownerId_key" ON "BotAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccount_botUserId_key" ON "BotAccount"("botUserId");

-- AddForeignKey
ALTER TABLE "BotAccount" ADD CONSTRAINT "BotAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

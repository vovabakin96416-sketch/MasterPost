-- AlterTable
ALTER TABLE "Cooldown" ADD COLUMN     "recent" TEXT[] DEFAULT ARRAY[]::TEXT[];

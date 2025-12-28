-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "attemptsMade" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedAt" TIMESTAMP(3);

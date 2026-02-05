-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "aiAttempts" INTEGER,
ADD COLUMN     "aiCompletionTokens" INTEGER,
ADD COLUMN     "aiLatencyMs" INTEGER,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiPromptTokens" INTEGER,
ADD COLUMN     "aiTotalTokens" INTEGER;

-- AlterTable
ALTER TABLE "SvgGeneration" ADD COLUMN     "privacy" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "model" SET DEFAULT 'gpt-5-mini';

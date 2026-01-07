/*
  Warnings:

  - A unique constraint covering the columns `[s3Key]` on the table `SvgGeneration` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SvgGeneration" ADD COLUMN     "s3Key" TEXT,
ADD COLUMN     "s3SizeBytes" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "SvgGeneration_s3Key_key" ON "SvgGeneration"("s3Key");

/*
  Warnings:

  - You are about to drop the column `tokensUsed` on the `SvgGeneration` table. All the data in the column will be lost.
  - You are about to drop the column `credits` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SvgGeneration" DROP COLUMN "tokensUsed",
ADD COLUMN     "coinsUsed" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "credits",
ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 100;

/*
  Warnings:

  - The values [STUDENT,PRO] on the enum `Plan` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `coinsUsed` on the `SvgGeneration` table. All the data in the column will be lost.
  - You are about to drop the column `coins` on the `User` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Plan_new" AS ENUM ('FREE', 'CUSTOMER', 'UNLIMITED');
ALTER TABLE "public"."User" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
ALTER TYPE "Plan" RENAME TO "Plan_old";
ALTER TYPE "Plan_new" RENAME TO "Plan";
DROP TYPE "public"."Plan_old";
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
COMMIT;

-- AlterTable
ALTER TABLE "SvgGeneration" DROP COLUMN "coinsUsed",
ADD COLUMN     "creditsUsed" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "coins",
ADD COLUMN     "credits" INTEGER NOT NULL DEFAULT 3;

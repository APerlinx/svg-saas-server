/*
  Warnings:

  - The values [PRO,ENTERPRISE] on the enum `Plan` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Plan_new" AS ENUM ('FREE', 'SUPPORTER');
ALTER TABLE "public"."User" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
ALTER TYPE "Plan" RENAME TO "Plan_old";
ALTER TYPE "Plan_new" RENAME TO "Plan";
DROP TYPE "public"."Plan_old";
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditRefillAmount" INTEGER,
ADD COLUMN     "lastCreditRefillAt" TIMESTAMP(3),
ADD COLUMN     "nextCreditRefillAt" TIMESTAMP(3),
ALTER COLUMN "credits" SET DEFAULT 100;

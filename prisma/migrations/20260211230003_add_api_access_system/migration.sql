/*
  Warnings:

  - The values [CUSTOMER,UNLIMITED] on the enum `Plan` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "GenerationSource" AS ENUM ('WEB_APP', 'API');

-- AlterEnum
BEGIN;
CREATE TYPE "Plan_new" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
ALTER TABLE "public"."User" ALTER COLUMN "plan" DROP DEFAULT;

-- Migrate existing plan values
UPDATE "User" SET "plan" = 'PRO' WHERE "plan" = 'CUSTOMER';
UPDATE "User" SET "plan" = 'ENTERPRISE' WHERE "plan" = 'UNLIMITED';

ALTER TABLE "User" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
ALTER TYPE "Plan" RENAME TO "Plan_old";
ALTER TYPE "Plan_new" RENAME TO "Plan";
DROP TYPE "public"."Plan_old";
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
COMMIT;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "apiKeyId" TEXT,
ADD COLUMN     "source" "GenerationSource" NOT NULL DEFAULT 'WEB_APP';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apiQuotaLimit" INTEGER,
ADD COLUMN     "apiQuotaResetAt" TIMESTAMP(3),
ADD COLUMN     "apiQuotaUsed" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "scopes" TEXT[] DEFAULT ARRAY['generate:svg', 'read:generation']::TEXT[],
    "customRateLimit" INTEGER,
    "environment" TEXT DEFAULT 'production',
    "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyUsageLog" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latencyMs" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "creditsUsed" INTEGER,
    "tokensUsed" INTEGER,

    CONSTRAINT "ApiKeyUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_revokedAt_idx" ON "ApiKey"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ApiKey_lastUsedAt_idx" ON "ApiKey"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ApiKeyUsageLog_apiKeyId_timestamp_idx" ON "ApiKeyUsageLog"("apiKeyId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiKeyUsageLog_userId_timestamp_idx" ON "ApiKeyUsageLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiKeyUsageLog_timestamp_idx" ON "ApiKeyUsageLog"("timestamp");

-- CreateIndex
CREATE INDEX "ApiKeyUsageLog_statusCode_idx" ON "ApiKeyUsageLog"("statusCode");

-- CreateIndex
CREATE INDEX "GenerationJob_apiKeyId_idx" ON "GenerationJob"("apiKeyId");

-- CreateIndex
CREATE INDEX "GenerationJob_source_createdAt_idx" ON "GenerationJob"("source", "createdAt");

-- CreateIndex
CREATE INDEX "User_plan_idx" ON "User"("plan");

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyUsageLog" ADD CONSTRAINT "ApiKeyUsageLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyUsageLog" ADD CONSTRAINT "ApiKeyUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

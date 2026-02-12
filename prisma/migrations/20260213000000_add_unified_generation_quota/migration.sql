-- AlterTable: Add unified generation quota fields to User table
-- These replace the dual-system of daily limits (web) and API quota (API)

-- Add new unified generation quota fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "generationsQuotaLimit" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "generationsQuotaUsed" INTEGER DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "generationsQuotaResetAt" TIMESTAMP(3);

-- Migrate existing API quota data to new unified quota (one-time migration)
-- This preserves existing usage tracking during transition
UPDATE "User" 
SET 
  "generationsQuotaUsed" = COALESCE("apiQuotaUsed", 0),
  "generationsQuotaLimit" = COALESCE("apiQuotaLimit", 
    CASE 
      WHEN plan = 'FREE' THEN 1000
      WHEN plan = 'PRO' THEN 10000
      WHEN plan = 'ENTERPRISE' THEN 100000
      ELSE 1000
    END
  ),
  "generationsQuotaResetAt" = COALESCE("apiQuotaResetAt", NOW() + INTERVAL '30 days')
WHERE "generationsQuotaUsed" IS NULL;

-- Note: Keep apiQuota* fields for backward compatibility
-- They can be removed in a future migration after confirming the new system works

/*
  Warnings:

  - A unique constraint covering the columns `[paypalCustomerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[paypalSubscriptionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "paypalCustomerId" TEXT,
ADD COLUMN     "paypalPlanId" TEXT,
ADD COLUMN     "paypalSubscriptionId" TEXT,
ADD COLUMN     "paypalSubscriptionStatus" TEXT;

-- CreateTable
CREATE TABLE "PayPalWebhookEvent" (
    "id" TEXT NOT NULL,
    "paypalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT,
    "userId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "PayPalWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPalWebhookEvent_paypalEventId_key" ON "PayPalWebhookEvent"("paypalEventId");

-- CreateIndex
CREATE INDEX "PayPalWebhookEvent_eventType_receivedAt_idx" ON "PayPalWebhookEvent"("eventType", "receivedAt");

-- CreateIndex
CREATE INDEX "PayPalWebhookEvent_resourceId_idx" ON "PayPalWebhookEvent"("resourceId");

-- CreateIndex
CREATE INDEX "PayPalWebhookEvent_userId_receivedAt_idx" ON "PayPalWebhookEvent"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_paypalCustomerId_key" ON "User"("paypalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_paypalSubscriptionId_key" ON "User"("paypalSubscriptionId");

-- AddForeignKey
ALTER TABLE "PayPalWebhookEvent" ADD CONSTRAINT "PayPalWebhookEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

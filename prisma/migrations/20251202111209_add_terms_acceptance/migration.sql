-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedIp" TEXT,
ALTER COLUMN "coins" SET DEFAULT 10;

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

/*
  Warnings:

  - You are about to drop the column `clientId` on the `OAuthAccessToken` table. All the data in the column will be lost.
  - You are about to drop the column `clientId` on the `OAuthAuthorizationCode` table. All the data in the column will be lost.
  - You are about to drop the column `clientId` on the `OAuthRefreshToken` table. All the data in the column will be lost.
  - Added the required column `oauthClientId` to the `OAuthAccessToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `oauthClientId` to the `OAuthAuthorizationCode` table without a default value. This is not possible if the table is not empty.
  - Added the required column `oauthClientId` to the `OAuthRefreshToken` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "OAuthAccessToken" DROP CONSTRAINT "OAuthAccessToken_clientId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAuthorizationCode" DROP CONSTRAINT "OAuthAuthorizationCode_clientId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthRefreshToken" DROP CONSTRAINT "OAuthRefreshToken_clientId_fkey";

-- DropIndex
DROP INDEX "OAuthAccessToken_clientId_idx";

-- DropIndex
DROP INDEX "OAuthAuthorizationCode_clientId_idx";

-- DropIndex
DROP INDEX "OAuthRefreshToken_clientId_idx";

-- AlterTable
ALTER TABLE "OAuthAccessToken" DROP COLUMN "clientId",
ADD COLUMN     "oauthClientId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OAuthAuthorizationCode" DROP COLUMN "clientId",
ADD COLUMN     "oauthClientId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OAuthRefreshToken" DROP COLUMN "clientId",
ADD COLUMN     "oauthClientId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "OAuthAccessToken_oauthClientId_idx" ON "OAuthAccessToken"("oauthClientId");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_oauthClientId_idx" ON "OAuthAuthorizationCode"("oauthClientId");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_oauthClientId_idx" ON "OAuthRefreshToken"("oauthClientId");

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

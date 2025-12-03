/*
  Warnings:

  - A unique constraint covering the columns `[providerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'GITHUB');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "provider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "providerId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_providerId_key" ON "User"("providerId");

-- CreateIndex
CREATE INDEX "User_providerId_idx" ON "User"("providerId");

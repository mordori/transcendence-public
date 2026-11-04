/*
  Warnings:

  - You are about to drop the column `playerId` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the `Player` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[playerAccountId]` on the table `Session` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `playerAccountId` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_playerId_fkey";

-- DropIndex
DROP INDEX "Session_playerId_key";

-- DropIndex
DROP INDEX "Session_tokenHash_idx";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "playerId",
ADD COLUMN     "playerAccountId" INTEGER NOT NULL;

-- DropTable
DROP TABLE "Player";

-- CreateTable
CREATE TABLE "PlayerAccount" (
    "accountId" SERIAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAccount_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "match_histories" (
    "match_id" TEXT NOT NULL,
    "game_mode" TEXT NOT NULL,
    "winning_team" TEXT NOT NULL,
    "player_stats" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_histories_pkey" PRIMARY KEY ("match_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAccount_displayName_key" ON "PlayerAccount"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAccount_email_key" ON "PlayerAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_playerAccountId_key" ON "Session"("playerAccountId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

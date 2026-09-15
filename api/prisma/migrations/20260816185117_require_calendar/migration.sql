/*
  Warnings:

  - Made the column `calendarId` on table `Event` required. This step will fail if there are existing NULL values in that column.
  - Made the column `calendarId` on table `Person` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "calendarId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Person" ALTER COLUMN "calendarId" SET NOT NULL;

ALTER TABLE "User" ADD COLUMN "managedById" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_managedById_fkey" FOREIGN KEY ("managedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Calendar" ADD COLUMN "ownerId" TEXT;
UPDATE "Calendar" c SET "ownerId" = (SELECT m."userId" FROM "CalendarMember" m JOIN "User" u ON u.id=m."userId" WHERE m."calendarId"=c.id AND m.role='ADMIN' ORDER BY u."createdAt", u.id LIMIT 1);
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE "CalendarMember" m SET role='EDIT' FROM "Calendar" c WHERE c.id=m."calendarId" AND m.role='ADMIN' AND m."userId" <> c."ownerId";
ALTER TABLE "CalendarFeed" ADD COLUMN "ownerId" TEXT, ADD COLUMN "color" TEXT NOT NULL DEFAULT '#627faa';
UPDATE "CalendarFeed" f SET "ownerId"=c."ownerId" FROM "Calendar" c WHERE c.id=f."calendarId";
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "FeedShare" ("feedId" TEXT NOT NULL, "userId" TEXT NOT NULL, PRIMARY KEY ("feedId", "userId"), FOREIGN KEY ("feedId") REFERENCES "CalendarFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
-- Existing shared subscriptions retain their audience; newly added feeds are private.
INSERT INTO "FeedShare" ("feedId", "userId") SELECT f.id, m."userId" FROM "CalendarFeed" f JOIN "CalendarMember" m ON m."calendarId"=f."calendarId" WHERE m."userId" IS DISTINCT FROM f."ownerId";

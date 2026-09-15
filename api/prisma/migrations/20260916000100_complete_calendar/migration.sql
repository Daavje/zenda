ALTER TABLE "Event" ADD COLUMN "reminderMinutes" INTEGER, ADD COLUMN "excludedDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "externalUid" TEXT;
CREATE UNIQUE INDEX "Event_calendarId_externalUid_key" ON "Event"("calendarId", "externalUid");
CREATE INDEX "Event_calendarId_start_idx" ON "Event"("calendarId", "start");
CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Attachment" ("id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE, "name" TEXT NOT NULL, "data" BYTEA NOT NULL, "size" INTEGER NOT NULL);
CREATE TABLE "PushSubscription" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "endpoint" TEXT NOT NULL UNIQUE, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL);
CREATE TABLE "NotificationDelivery" ("id" TEXT PRIMARY KEY, "subscriptionId" TEXT NOT NULL REFERENCES "PushSubscription"("id") ON DELETE CASCADE, "occurrenceKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "NotificationDelivery_subscriptionId_occurrenceKey_key" ON "NotificationDelivery"("subscriptionId", "occurrenceKey");

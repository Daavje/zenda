import assert from "node:assert/strict";
import webpush from "web-push";
import { prisma } from "../src/prisma";
async function main() {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  const { sendReminders } = await import("../src/notifications");
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: "Reminder test",
      email: `reminder${Date.now()}@example.test`,
      passwordHash: "unused-test-only",
    },
  });
  const calendar = await prisma.calendar.create({
    data: {
      name: "Reminder calendar",
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  await prisma.event.create({
    data: {
      calendarId: calendar.id,
      title: "Due reminder",
      start: new Date(+now + 15 * 60000),
      end: new Date(+now + 75 * 60000),
      reminderMinutes: 15,
    },
  });
  const subscription = await prisma.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: "https://fcm.googleapis.com/test-only-do-not-send",
      p256dh: "test",
      auth: "test",
    },
  });
  const deliveries: string[] = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = (async (_subscription, payload) => {
    deliveries.push(String(payload));
    return { statusCode: 201, headers: {}, body: "" };
  }) as typeof original;
  try {
    await sendReminders(now);
    await sendReminders(new Date(+now + 30000));
    assert.equal(
      deliveries.length,
      1,
      "One reminder, even with overlapping worker checks",
    );
    assert.equal(JSON.parse(deliveries[0]).title, "Due reminder");
    assert.equal(
      await prisma.notificationDelivery.count({
        where: { subscriptionId: subscription.id },
      }),
      1,
    );
    await prisma.calendarMember.delete({
      where: {
        userId_calendarId: { userId: user.id, calendarId: calendar.id },
      },
    });
    await prisma.notificationDelivery.deleteMany({
      where: { subscriptionId: subscription.id },
    });
    await sendReminders(now);
    assert.equal(deliveries.length, 1, "Revoked members receive no reminders");
    console.log(
      "PASS: reminders, delivery deduplication and revoked membership (push provider mocked; no external notification sent).",
    );
  } finally {
    webpush.sendNotification = original;
    await prisma.$disconnect();
  }
}
main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});

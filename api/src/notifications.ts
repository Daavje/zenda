import webpush from "web-push";
import { prisma } from "./prisma";
import { generateOccurrences } from "./calendar/recurrence";
export const pushKey = process.env.VAPID_PUBLIC_KEY || null;
const enabled = !!(pushKey && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT!, pushKey!, process.env.VAPID_PRIVATE_KEY!);
export async function saveSubscription(userId: string, body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
  const url = new URL(body.endpoint || "invalid");
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port || !(host === "fcm.googleapis.com" || host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" || host.endsWith(".notify.windows.com"))) throw new Error("Onbekende pushdienst.");
  if (!body.keys?.p256dh || !body.keys.auth || body.keys.p256dh.length > 256 || body.keys.auth.length > 256 || url.href.length > 2048) throw new Error("Ongeldige notificatiesleutel.");
  const data = { userId, p256dh: body.keys.p256dh, auth: body.keys.auth };
  await prisma.pushSubscription.upsert({ where: { endpoint: url.href }, create: { endpoint: url.href, ...data }, update: data });
}
let running = false;
export async function sendReminders(now = new Date()) {
  if (!enabled || running) return;
  running = true;
  try {
    const events = await prisma.event.findMany({ where: { reminderMinutes: { not: null } }, include: { calendar: { include: { members: { include: { user: { include: { subscriptions: true } } } } } } } });
    for (const event of events) {
      const ahead = (event.reminderMinutes || 0) * 60000;
      const occurrences = generateOccurrences(event.start, event.end, event.recurrenceRule, new Date(+now + ahead - 60000), new Date(+now + ahead + 60000), event.recurrenceTimezone || event.calendar.timezone, event.excludedDates);
      for (const occurrence of occurrences) {
        const due = +occurrence.start - ahead;
        if (due > +now || due < +now - 60000) continue;
        for (const member of event.calendar.members) for (const subscription of member.user.subscriptions) {
          const occurrenceKey = `${event.id}:${occurrence.start.toISOString()}:${event.reminderMinutes}`;
          const claimed = await prisma.notificationDelivery.createMany({ data: [{ subscriptionId: subscription.id, occurrenceKey }], skipDuplicates: true });
          if (!claimed.count) continue;
          try {
            await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: event.title, body: `${event.calendar.name} · ${occurrence.start.toLocaleTimeString("nl-NL", { timeZone: event.calendar.timezone, hour: "2-digit", minute: "2-digit" })}${event.location ? " · " + event.location : ""}`, tag: occurrenceKey }), { TTL: 120, timeout: 10000 });
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
            else await prisma.notificationDelivery.deleteMany({ where: { subscriptionId: subscription.id, occurrenceKey } });
          }
        }
      }
    }
    await prisma.notificationDelivery.deleteMany({ where: { createdAt: { lt: new Date(+now - 30 * 86400000) } } });
    await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  } finally { running = false; }
}
export function startReminders() { if (enabled) { const timer = setInterval(() => { sendReminders().catch(console.error); }, 30000); timer.unref(); } }

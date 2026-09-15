import { prisma } from "../prisma";
import { importCalendar } from "./ical";
import { fetchCalendar } from "./remote-fetch";

const syncing = new Set<string>();
export async function syncFeed(id: string) {
  if (syncing.has(id)) return;
  syncing.add(id);
  try {
    const feed = await prisma.calendarFeed.findUnique({
      where: { id },
      include: { calendar: true },
    });
    if (!feed) return;
    try {
      const imported = importCalendar(
        await fetchCalendar(feed.url),
        feed.calendar.timezone,
      ).map((event) => ({
        ...event,
        externalUid: `${id}:${event.externalUid}`,
      }));
      await prisma.$transaction(
        async (tx) => {
          for (const event of imported)
            await tx.event.upsert({
              where: {
                calendarId_externalUid: {
                  calendarId: feed.calendarId,
                  externalUid: event.externalUid,
                },
              },
              create: { ...event, calendarId: feed.calendarId, feedId: id },
              update: event,
            });
          await tx.event.deleteMany({
            where: {
              feedId: id,
              externalUid: {
                notIn: imported.map((event) => event.externalUid),
              },
            },
          });
          await tx.calendarFeed.update({
            where: { id },
            data: { lastSync: new Date(), lastError: null },
          });
        },
        { timeout: 30000 },
      );
    } catch (error) {
      await prisma.calendarFeed.update({
        where: { id },
        data: {
          lastError:
            error instanceof Error
              ? error.message.slice(0, 250)
              : "Synchronisatie mislukt.",
        },
      });
    }
  } finally {
    syncing.delete(id);
  }
}
export function startFeedSync() {
  const run = async () => {
    const feeds = await prisma.calendarFeed.findMany();
    for (const feed of feeds) await syncFeed(feed.id);
  };
  void run().catch(console.error);
  const timer = setInterval(() => {
    void run().catch(console.error);
  }, 15 * 60000);
  timer.unref();
}

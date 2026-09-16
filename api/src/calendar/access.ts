import type { Prisma } from "@prisma/client";

export const visibleFeed = (userId: string): Prisma.CalendarFeedWhereInput => ({
  OR: [{ ownerId: userId }, { shares: { some: { userId } } }],
});
export const visibleEvent = (userId: string): Prisma.EventWhereInput => ({
  OR: [{ feedId: null }, { feed: { is: visibleFeed(userId) } }],
});

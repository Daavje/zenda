import { prisma } from "../src/prisma";

async function main() {
  let calendar = await prisma.calendar.findFirst();

  if (!calendar) {
    calendar = await prisma.calendar.create({
      data: {
        name: "Mijn agenda",
        timezone: "Europe/Amsterdam",
      },
    });

    console.log(`Created calendar: ${calendar.id}`);
  }

  const peopleResult = await prisma.person.updateMany({
    where: {
      calendarId: null,
    },
    data: {
      calendarId: calendar.id,
    },
  });

  const eventsResult = await prisma.event.updateMany({
    where: {
      calendarId: null,
    },
    data: {
      calendarId: calendar.id,
    },
  });

  console.log(`Updated people: ${peopleResult.count}`);
  console.log(`Updated events: ${eventsResult.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
import express from "express";
import cors from "cors";

import { prisma } from "./prisma";
import { config } from "./config";
import { generateOccurrences } from "./calendar/recurrence";

const app = express();
const port = config.port;

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

async function getDefaultCalendar() {
  let calendar = await prisma.calendar.findFirst({
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!calendar) {
    calendar = await prisma.calendar.create({
      data: {
        name: "Familie",
        timezone: "Europe/Amsterdam",
      },
    });
  }

  return calendar;
}

async function calendarExists(calendarId: string) {
  const calendar = await prisma.calendar.findUnique({
    where: {
      id: calendarId,
    },
  });

  return calendar;
}

async function validatePeopleForCalendar(
  calendarId: string,
  people: unknown
) {
  if (!Array.isArray(people)) {
    return [];
  }

  const personIds = people.filter(
    (id): id is string => typeof id === "string"
  );

  if (personIds.length === 0) {
    return [];
  }

  const matchingPeople = await prisma.person.findMany({
    where: {
      id: {
        in: personIds,
      },
      calendarId,
    },
    select: {
      id: true,
    },
  });

  const matchingIds = new Set(
    matchingPeople.map((person) => person.id)
  );

  const invalidPeople = personIds.filter(
    (id) => !matchingIds.has(id)
  );

  if (invalidPeople.length > 0) {
    throw new Error(
      "One or more people do not belong to this calendar"
    );
  }

  return personIds;
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    application: "open-calendar",
  });
});

// --------------------------------------------------
// CALENDARS
// --------------------------------------------------

// Alle agenda's
app.get("/api/calendars", async (_req, res) => {
  try {
    const calendars = await prisma.calendar.findMany({
      orderBy: {
        createdAt: "asc",
      },
    });

    res.json(calendars);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch calendars",
    });
  }
});

// Eén agenda
app.get("/api/calendars/:calendarId", async (req, res) => {
  try {
    const { calendarId } = req.params;

    const calendar = await prisma.calendar.findUnique({
      where: {
        id: calendarId,
      },
    });

    if (!calendar) {
      return res.status(404).json({
        error: "Calendar not found",
      });
    }

    res.json(calendar);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch calendar",
    });
  }
});

// --------------------------------------------------
// CALENDAR PEOPLE
// --------------------------------------------------

// Personen van één agenda
app.get(
  "/api/calendars/:calendarId/people",
  async (req, res) => {
    try {
      const { calendarId } = req.params;

      const calendar = await calendarExists(calendarId);

      if (!calendar) {
        return res.status(404).json({
          error: "Calendar not found",
        });
      }

      const people = await prisma.person.findMany({
        where: {
          calendarId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      res.json(people);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to fetch people",
      });
    }
  }
);

// Persoon toevoegen aan agenda
app.post(
  "/api/calendars/:calendarId/people",
  async (req, res) => {
    try {
      const { calendarId } = req.params;
      const { name, initials, color } = req.body;

      const calendar = await calendarExists(calendarId);

      if (!calendar) {
        return res.status(404).json({
          error: "Calendar not found",
        });
      }

      if (!name || !initials || !color) {
        return res.status(400).json({
          error: "name, initials and color are required",
        });
      }

      const person = await prisma.person.create({
        data: {
          name: name.trim(),
          initials: initials
            .trim()
            .slice(0, 3)
            .toUpperCase(),
          color,
          calendarId,
        },
      });

      res.status(201).json(person);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to create person",
      });
    }
  }
);

// Persoon aanpassen
app.patch(
  "/api/calendars/:calendarId/people/:personId",
  async (req, res) => {
    try {
      const { calendarId, personId } = req.params;
      const { name, initials, color } = req.body;

      const person = await prisma.person.findFirst({
        where: {
          id: personId,
          calendarId,
        },
      });

      if (!person) {
        return res.status(404).json({
          error: "Person not found",
        });
      }

      const updatedPerson = await prisma.person.update({
        where: {
          id: personId,
        },
        data: {
          ...(name !== undefined && {
            name: name.trim(),
          }),

          ...(initials !== undefined && {
            initials: initials
              .trim()
              .slice(0, 3)
              .toUpperCase(),
          }),

          ...(color !== undefined && {
            color,
          }),
        },
      });

      res.json(updatedPerson);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to update person",
      });
    }
  }
);

// Persoon verwijderen
app.delete(
  "/api/calendars/:calendarId/people/:personId",
  async (req, res) => {
    try {
      const { calendarId, personId } = req.params;

      const person = await prisma.person.findFirst({
        where: {
          id: personId,
          calendarId,
        },
      });

      if (!person) {
        return res.status(404).json({
          error: "Person not found",
        });
      }

      await prisma.person.delete({
        where: {
          id: personId,
        },
      });

      res.status(204).send();
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to delete person",
      });
    }
  }
);

// --------------------------------------------------
// CALENDAR EVENTS
// --------------------------------------------------

// Events ophalen
app.get(
  "/api/calendars/:calendarId/events",
  async (req, res) => {
    try {
      const { calendarId } = req.params;

      const calendar = await calendarExists(calendarId);

      if (!calendar) {
        return res.status(404).json({
          error: "Calendar not found",
        });
      }

      const rangeStart = req.query.start
        ? new Date(String(req.query.start))
        : new Date();

      const rangeEnd = req.query.end
        ? new Date(String(req.query.end))
        : new Date(
            rangeStart.getTime() +
              1000 * 60 * 60 * 24 * 90
          );

      if (
        Number.isNaN(rangeStart.getTime()) ||
        Number.isNaN(rangeEnd.getTime())
      ) {
        return res.status(400).json({
          error: "Invalid date range",
        });
      }

      const events = await prisma.event.findMany({
        where: {
          calendarId,
          start: {
            lte: rangeEnd,
          },
        },

        orderBy: {
          start: "asc",
        },

        include: {
          people: {
            include: {
              person: true,
            },
          },
        },
      });

      const expandedEvents = [];

      for (const event of events) {
        const occurrences = generateOccurrences(
          event.start,
          event.end,
          event.recurrenceRule,
          rangeStart,
          rangeEnd
        );

        for (const occurrence of occurrences) {
          expandedEvents.push({
            ...event,
            start: occurrence.start,
            end: occurrence.end,
          });
        }
      }

      expandedEvents.sort(
        (a, b) =>
          a.start.getTime() -
          b.start.getTime()
      );

      res.json(expandedEvents);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to fetch events",
      });
    }
  }
);

// Event ophalen
app.get(
  "/api/calendars/:calendarId/events/:eventId",
  async (req, res) => {
    try {
      const { calendarId, eventId } = req.params;

      const event = await prisma.event.findFirst({
        where: {
          id: eventId,
          calendarId,
        },

        include: {
          people: {
            include: {
              person: true,
            },
          },
        },
      });

      if (!event) {
        return res.status(404).json({
          error: "Event not found",
        });
      }

      res.json(event);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to fetch event",
      });
    }
  }
);

// Event toevoegen
app.post(
  "/api/calendars/:calendarId/events",
  async (req, res) => {
    try {
      const { calendarId } = req.params;

      const {
        title,
        start,
        end,
        location,
        notes,
        recurrenceRule,
        people,
      } = req.body;

      const calendar = await calendarExists(calendarId);

      if (!calendar) {
        return res.status(404).json({
          error: "Calendar not found",
        });
      }

      if (!title || !start || !end) {
        return res.status(400).json({
          error: "title, start and end are required",
        });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        return res.status(400).json({
          error: "start and end must be valid dates",
        });
      }

      if (startDate >= endDate) {
        return res.status(400).json({
          error: "end must be after start",
        });
      }

      const personIds =
        await validatePeopleForCalendar(
          calendarId,
          people
        );

      const event = await prisma.event.create({
        data: {
          title: title.trim(),
          start: startDate,
          end: endDate,
          location: location?.trim() || null,
          notes: notes?.trim() || null,
          recurrenceRule:
            recurrenceRule || null,
          calendarId,

          people: {
            create: personIds.map(
              (personId: string) => ({
                person: {
                  connect: {
                    id: personId,
                  },
                },
              })
            ),
          },
        },

        include: {
          people: {
            include: {
              person: true,
            },
          },
        },
      });

      res.status(201).json(event);
    } catch (error) {
      console.error(error);

      if (
        error instanceof Error &&
        error.message.includes(
          "do not belong to this calendar"
        )
      ) {
        return res.status(400).json({
          error: error.message,
        });
      }

      res.status(500).json({
        error: "Failed to create event",
      });
    }
  }
);

// Event aanpassen
app.patch(
  "/api/calendars/:calendarId/events/:eventId",
  async (req, res) => {
    try {
      const { calendarId, eventId } = req.params;

      const {
        title,
        start,
        end,
        location,
        notes,
        recurrenceRule,
        people,
      } = req.body;

      const existingEvent =
        await prisma.event.findFirst({
          where: {
            id: eventId,
            calendarId,
          },
        });

      if (!existingEvent) {
        return res.status(404).json({
          error: "Event not found",
        });
      }

      const newStart =
        start !== undefined
          ? new Date(start)
          : existingEvent.start;

      const newEnd =
        end !== undefined
          ? new Date(end)
          : existingEvent.end;

      if (
        Number.isNaN(newStart.getTime()) ||
        Number.isNaN(newEnd.getTime())
      ) {
        return res.status(400).json({
          error: "start and end must be valid dates",
        });
      }

      if (newStart >= newEnd) {
        return res.status(400).json({
          error: "end must be after start",
        });
      }

      const personIds =
        people !== undefined
          ? await validatePeopleForCalendar(
              calendarId,
              people
            )
          : null;

      const event = await prisma.$transaction(
        async (transaction) => {
          if (personIds !== null) {
            await transaction.eventPerson.deleteMany({
              where: {
                eventId,
              },
            });
          }

          return transaction.event.update({
            where: {
              id: eventId,
            },

            data: {
              ...(title !== undefined && {
                title: title.trim(),
              }),

              ...(start !== undefined && {
                start: newStart,
              }),

              ...(end !== undefined && {
                end: newEnd,
              }),

              ...(location !== undefined && {
                location:
                  location?.trim() || null,
              }),

              ...(notes !== undefined && {
                notes:
                  notes?.trim() || null,
              }),

              ...(recurrenceRule !==
                undefined && {
                recurrenceRule:
                  recurrenceRule || null,
              }),

              ...(personIds !== null && {
                people: {
                  create: personIds.map(
                    (personId: string) => ({
                      person: {
                        connect: {
                          id: personId,
                        },
                      },
                    })
                  ),
                },
              }),
            },

            include: {
              people: {
                include: {
                  person: true,
                },
              },
            },
          });
        }
      );

      res.json(event);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to update event",
      });
    }
  }
);

// Event verwijderen
app.delete(
  "/api/calendars/:calendarId/events/:eventId",
  async (req, res) => {
    try {
      const { calendarId, eventId } = req.params;

      const event = await prisma.event.findFirst({
        where: {
          id: eventId,
          calendarId,
        },
      });

      if (!event) {
        return res.status(404).json({
          error: "Event not found",
        });
      }

      await prisma.event.delete({
        where: {
          id: eventId,
        },
      });

      res.status(204).send();
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Failed to delete event",
      });
    }
  }
);

// --------------------------------------------------
// TEMPORARY LEGACY ROUTES
// --------------------------------------------------
//
// Deze houden je huidige frontend voorlopig werkend.
// Zodra de frontend naar /api/calendars/:calendarId/...
// is omgezet, kunnen we deze verwijderen.
// --------------------------------------------------

app.get("/api/people", async (_req, res) => {
  try {
    const calendar = await getDefaultCalendar();

    const people = await prisma.person.findMany({
      where: {
        calendarId: calendar.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    res.json(people);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch people",
    });
  }
});

app.post("/api/people", async (req, res) => {
  try {
    const calendar = await getDefaultCalendar();

    const { name, initials, color } = req.body;

    if (!name || !initials || !color) {
      return res.status(400).json({
        error: "name, initials and color are required",
      });
    }

    const person = await prisma.person.create({
      data: {
        name: name.trim(),
        initials: initials
          .trim()
          .slice(0, 3)
          .toUpperCase(),
        color,
        calendarId: calendar.id,
      },
    });

    res.status(201).json(person);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to create person",
    });
  }
});

app.patch("/api/people/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const person = await prisma.person.findUnique({
      where: {
        id,
      },
    });

    if (!person) {
      return res.status(404).json({
        error: "Person not found",
      });
    }

    const { name, initials, color } = req.body;

    const updatedPerson = await prisma.person.update({
      where: {
        id,
      },
      data: {
        ...(name !== undefined && {
          name: name.trim(),
        }),

        ...(initials !== undefined && {
          initials: initials
            .trim()
            .slice(0, 3)
            .toUpperCase(),
        }),

        ...(color !== undefined && {
          color,
        }),
      },
    });

    res.json(updatedPerson);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to update person",
    });
  }
});

app.delete("/api/people/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const person = await prisma.person.findUnique({
      where: {
        id,
      },
    });

    if (!person) {
      return res.status(404).json({
        error: "Person not found",
      });
    }

    await prisma.person.delete({
      where: {
        id,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to delete person",
    });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const calendar = await getDefaultCalendar();

    const rangeStart = req.query.start
      ? new Date(String(req.query.start))
      : new Date();

    const rangeEnd = req.query.end
      ? new Date(String(req.query.end))
      : new Date(
          rangeStart.getTime() +
            1000 * 60 * 60 * 24 * 90
        );

    const events = await prisma.event.findMany({
      where: {
        calendarId: calendar.id,
        start: {
          lte: rangeEnd,
        },
      },

      orderBy: {
        start: "asc",
      },

      include: {
        people: {
          include: {
            person: true,
          },
        },
      },
    });

    const expandedEvents = [];

    for (const event of events) {
      const occurrences = generateOccurrences(
        event.start,
        event.end,
        event.recurrenceRule,
        rangeStart,
        rangeEnd
      );

      for (const occurrence of occurrences) {
        expandedEvents.push({
          ...event,
          start: occurrence.start,
          end: occurrence.end,
        });
      }
    }

    expandedEvents.sort(
      (a, b) =>
        a.start.getTime() -
        b.start.getTime()
    );

    res.json(expandedEvents);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch events",
    });
  }
});

app.post("/api/events", async (req, res) => {
  try {
    const calendar = await getDefaultCalendar();

    const {
      title,
      start,
      end,
      location,
      notes,
      recurrenceRule,
      people,
    } = req.body;

    if (!title || !start || !end) {
      return res.status(400).json({
        error: "title, start and end are required",
      });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return res.status(400).json({
        error: "start and end must be valid dates",
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        error: "end must be after start",
      });
    }

    const personIds =
      await validatePeopleForCalendar(
        calendar.id,
        people
      );

    const event = await prisma.event.create({
      data: {
        title: title.trim(),
        start: startDate,
        end: endDate,
        location: location?.trim() || null,
        notes: notes?.trim() || null,
        recurrenceRule:
          recurrenceRule || null,
        calendarId: calendar.id,

        people: {
          create: personIds.map(
            (personId: string) => ({
              person: {
                connect: {
                  id: personId,
                },
              },
            })
          ),
        },
      },

      include: {
        people: {
          include: {
            person: true,
          },
        },
      },
    });

    res.status(201).json(event);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to create event",
    });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: {
        id,
      },
    });

    if (!event) {
      return res.status(404).json({
        error: "Event not found",
      });
    }

    await prisma.event.delete({
      where: {
        id,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to delete event",
    });
  }
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

app.listen(port, () => {
  console.log(
    `API running on http://localhost:${port}`
  );
});
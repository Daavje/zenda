import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./prisma";
import {
  generateOccurrences,
  parseRecurrenceRule,
} from "./calendar/recurrence";
import { importCalendar, exportCalendar } from "./calendar/ical";
import { startFeedSync, syncFeed } from "./calendar/feeds";
import { startReminders, pushKey, saveSubscription } from "./notifications";

const scrypt = promisify(scryptCallback);
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  if (
    ["POST", "PATCH"].includes(req.method) &&
    (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
  )
    return res.status(400).json({ error: "Stuur een geldig JSON-object." });
  next();
});
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origins = (
      process.env.APP_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",");
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin && !origins.includes(req.headers.origin))
    )
      return res
        .status(403)
        .json({ error: "Deze website heeft geen toegang tot de API." });
  }
  next();
});
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const text = (value: unknown, label: string, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return fail(400, `${label} ontbreekt of is te lang.`);
  return value.trim();
};
const date = (value: unknown) => {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return fail(400, "Datum moet een tijdzone bevatten.");
  const result = new Date(value);
  if (
    !Number.isFinite(+result) ||
    result.getUTCFullYear() < 1900 ||
    result.getUTCFullYear() > 2200
  )
    return fail(400, "Ongeldige datum.");
  return result;
};
const cookieName = "zenda_session";
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function sessionToken(req: Request) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
}
async function startSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: tokenHash(token),
      userId,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
const publicUser = { id: true, name: true, email: true } as const;
const attempts = new Map<string, { count: number; until: number }>();
app.use("/api/auth", (req, _res, next) => {
  if (req.method === "POST") {
    const key = req.ip || "local";
    const now = Date.now();
    for (const [id, value] of attempts)
      if (value.until < now) attempts.delete(id);
    const value = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (++value.count > 30)
      return next(
        new HttpError(
          429,
          "Te veel pogingen. Probeer over 15 minuten opnieuw.",
        ),
      );
    attempts.set(key, value);
  }
  next();
});
app.get("/api/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", application: "zenda" });
});
app.post("/api/auth/register", async (req, res) => {
  const name = text(req.body.name, "Naam", 100);
  const email = text(req.body.email, "E-mailadres", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Vul een geldig e-mailadres in.");
  const password = text(req.body.password, "Wachtwoord", 256);
  if (password.length < 12)
    fail(400, "Gebruik een wachtwoord van minimaal 12 tekens.");
  const salt = randomBytes(16).toString("hex");
  const hash = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
  const user = await prisma.$transaction(async (tx) => {
    // Serializes initial registration, so only the first account adopts legacy calendars.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(8726301)::text`;
    const first = (await tx.user.count()) === 0;
    if (await tx.user.findUnique({ where: { email } }))
      fail(409, "Dit e-mailadres is al geregistreerd.");
    const user = await tx.user.create({
      data: { name, email, passwordHash: `${salt}:${hash}` },
      select: publicUser,
    });
    if (first) {
      const calendars = await tx.calendar.findMany({
        where: { members: { none: {} } },
      });
      for (const calendar of calendars)
        await tx.calendarMember.create({
          data: { userId: user.id, calendarId: calendar.id, role: "ADMIN" },
        });
    }
    if ((await tx.calendarMember.count({ where: { userId: user.id } })) === 0)
      await tx.calendar.create({
        data: {
          name: "Mijn gezin",
          members: { create: { userId: user.id, role: "ADMIN" } },
        },
      });
    return user;
  });
  await startSession(user.id, res);
  res.status(201).json(user);
});
app.post("/api/auth/login", async (req, res) => {
  const email = text(req.body.email, "E-mailadres", 254).toLowerCase();
  const password = text(req.body.password, "Wachtwoord", 256);
  const user = await prisma.user.findUnique({ where: { email } });
  const [salt, hash] = user?.passwordHash.split(":") || [
    "invalid",
    "00".repeat(64),
  ];
  const calculated = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash || "", "hex");
  if (
    !user ||
    expected.length !== calculated.length ||
    !timingSafeEqual(calculated, expected)
  )
    fail(401, "E-mailadres of wachtwoord klopt niet.");
  await startSession(user!.id, res);
  res.json({ id: user!.id, name: user!.name, email: user!.email });
});
app.use("/api", async (req, res, next) => {
  const token = sessionToken(req);
  const session =
    token &&
    (await prisma.session.findUnique({
      where: { id: tokenHash(token) },
      include: { user: { select: publicUser } },
    }));
  if (!session || session.expiresAt < new Date())
    return res.status(401).json({ error: "Log in om je agenda te openen." });
  res.locals.user = session.user;
  next();
});
app.get("/api/auth/me", (_req, res) => res.json(res.locals.user));
app.post("/api/auth/logout", async (req, res) => {
  await prisma.session.deleteMany({
    where: { id: tokenHash(sessionToken(req)!) },
  });
  res.clearCookie(cookieName, { path: "/" });
  res.status(204).end();
});
app.get("/api/push/key", (_req, res) => res.json({ key: pushKey }));
app.post("/api/push", async (req, res) => {
  await saveSubscription(res.locals.user.id, req.body);
  res.status(204).end();
});
app.delete("/api/push", async (req, res) => {
  await prisma.pushSubscription.deleteMany({
    where: {
      userId: res.locals.user.id,
      endpoint: text(req.body.endpoint, "Pushadres", 2048),
    },
  });
  res.status(204).end();
});
app.get("/api/calendars", async (_req, res) => {
  const memberships = await prisma.calendarMember.findMany({
    where: { userId: res.locals.user.id },
    include: { calendar: true },
    orderBy: { calendar: { createdAt: "asc" } },
  });
  res.json(memberships.map(({ calendar, role }) => ({ ...calendar, role })));
});
app.post("/api/calendars", async (req, res) => {
  const name = text(req.body.name, "Agendanaam", 100);
  const timezone = req.body.timezone || "Europe/Amsterdam";
  try {
    new Intl.DateTimeFormat("nl", { timeZone: timezone });
  } catch {
    fail(400, "Onbekende tijdzone.");
  }
  const calendar = await prisma.calendar.create({
    data: {
      name,
      timezone,
      members: { create: { userId: res.locals.user.id, role: "ADMIN" } },
    },
  });
  res.status(201).json({ ...calendar, role: "ADMIN" });
});
app.use("/api/calendars/:calendarId", async (req, res, next) => {
  const member = await prisma.calendarMember.findUnique({
    where: {
      userId_calendarId: {
        userId: res.locals.user.id,
        calendarId: String(req.params.calendarId),
      },
    },
    include: { calendar: true },
  });
  if (!member) return res.status(404).json({ error: "Agenda niet gevonden." });
  if (req.method !== "GET" && member.role === "VIEW")
    return res
      .status(403)
      .json({ error: "Je hebt alleen leesrechten voor deze agenda." });
  res.locals.calendar = member.calendar;
  res.locals.role = member.role;
  next();
});
const prefix = "/api/calendars/:calendarId";
app.get(`${prefix}/feeds`, async (_req, res) => {
  res.json(
    await prisma.calendarFeed.findMany({
      where: { calendarId: res.locals.calendar.id },
      select: { id: true, name: true, lastSync: true, lastError: true },
    }),
  );
});
app.post(`${prefix}/feeds`, async (req, res) => {
  if (res.locals.role !== "ADMIN")
    fail(403, "Alleen de beheerder kan koppelingen instellen.");
  const name = text(req.body.name, "Naam", 100),
    url = text(req.body.url, "Agendalink", 2048);
  if (
    (await prisma.calendarFeed.count({
      where: { calendarId: res.locals.calendar.id },
    })) >= 10
  )
    fail(400, "Maximaal 10 externe agenda’s per agenda.");
  try {
    const parsed = new URL(url.replace(/^webcal:/i, "https:"));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error();
  } catch {
    fail(400, "Gebruik een geldige HTTPS- of webcal-link.");
  }
  const feed = await prisma.calendarFeed.create({
    data: { calendarId: res.locals.calendar.id, name, url },
  });
  await syncFeed(feed.id);
  res.status(201).json({ id: feed.id });
});
app.post(`${prefix}/feeds/:id/sync`, async (req, res) => {
  if (res.locals.role !== "ADMIN")
    fail(403, "Alleen de beheerder kan koppelingen verversen.");
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: String(req.params.id), calendarId: res.locals.calendar.id },
  });
  if (!feed) fail(404, "Koppeling niet gevonden.");
  await syncFeed(feed!.id);
  res.status(204).end();
});
app.delete(`${prefix}/feeds/:id`, async (req, res) => {
  if (res.locals.role !== "ADMIN")
    fail(403, "Alleen de beheerder kan koppelingen verwijderen.");
  await prisma.calendarFeed.deleteMany({
    where: { id: String(req.params.id), calendarId: res.locals.calendar.id },
  });
  res.status(204).end();
});
app.get(`${prefix}/members`, async (_req, res) => {
  if (res.locals.role !== "ADMIN")
    fail(403, "Alleen de beheerder kan leden beheren.");
  res.json(
    await prisma.calendarMember.findMany({
      where: { calendarId: res.locals.calendar.id },
      include: { user: { select: publicUser } },
    }),
  );
});
app.post(`${prefix}/members`, async (req, res) => {
  if (res.locals.role !== "ADMIN")
    fail(403, "Alleen de beheerder kan leden beheren.");
  const email = text(req.body.email, "E-mailadres", 254).toLowerCase();
  if (!["VIEW", "EDIT", "ADMIN"].includes(req.body.role))
    fail(400, "Ongeldige rol.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) fail(404, "Laat deze persoon eerst een account aanmaken.");
  if (user!.id === res.locals.user.id)
    fail(400, "Je kunt je eigen beheerdersrol niet wijzigen.");
  res.json(
    await prisma.calendarMember.upsert({
      where: {
        userId_calendarId: {
          userId: user!.id,
          calendarId: res.locals.calendar.id,
        },
      },
      create: {
        userId: user!.id,
        calendarId: res.locals.calendar.id,
        role: req.body.role,
      },
      update: { role: req.body.role },
    }),
  );
});
app.delete(`${prefix}/members/:userId`, async (req, res) => {
  if (res.locals.role !== "ADMIN" || req.params.userId === res.locals.user.id)
    fail(403, "Dit lid kan niet worden verwijderd.");
  await prisma.calendarMember.deleteMany({
    where: {
      calendarId: res.locals.calendar.id,
      userId: String(req.params.userId),
    },
  });
  res.status(204).end();
});
const peopleData = (body: Record<string, unknown>) => {
  const name = text(body.name, "Naam", 100),
    initials = text(body.initials, "Initialen", 3).toUpperCase();
  if (typeof body.color !== "string" || !/^#[0-9a-f]{6}$/i.test(body.color))
    fail(400, "Kies een geldige kleur.");
  return { name, initials, color: body.color as string };
};
app.get(`${prefix}/people`, async (_req, res) =>
  res.json(
    await prisma.person.findMany({
      where: { calendarId: res.locals.calendar.id },
      orderBy: { createdAt: "asc" },
    }),
  ),
);
app.post(`${prefix}/people`, async (req, res) =>
  res.status(201).json(
    await prisma.person.create({
      data: { ...peopleData(req.body), calendarId: res.locals.calendar.id },
    }),
  ),
);
app.patch(`${prefix}/people/:id`, async (req, res) => {
  const result = await prisma.person.updateMany({
    where: { id: String(req.params.id), calendarId: res.locals.calendar.id },
    data: peopleData(req.body),
  });
  if (!result.count) fail(404, "Persoon niet gevonden.");
  res.json(
    await prisma.person.findUnique({ where: { id: String(req.params.id) } }),
  );
});
app.delete(`${prefix}/people/:id`, async (req, res) => {
  const result = await prisma.person.deleteMany({
    where: { id: String(req.params.id), calendarId: res.locals.calendar.id },
  });
  if (!result.count) fail(404, "Persoon niet gevonden.");
  res.status(204).end();
});
const include = {
  people: { include: { person: true } },
  attachments: { select: { id: true, name: true, size: true } },
} as const;
async function findEvent(req: Request, res: Response) {
  const event = await prisma.event.findFirst({
    where: { id: String(req.params.id), calendarId: res.locals.calendar.id },
    include,
  });
  return event || fail(404, "Afspraak niet gevonden.");
}
app.get(`${prefix}/events`, async (req, res) => {
  const start = date(req.query.start),
    end = date(req.query.end);
  if (end <= start || +end - +start > 367 * 86400000)
    fail(400, "Kies een bereik van maximaal één jaar.");
  const events = await prisma.event.findMany({
    where: {
      calendarId: res.locals.calendar.id,
      start: { lt: end },
      OR: [{ end: { gt: start } }, { recurrenceRule: { not: null } }],
    },
    include,
  });
  res.json(
    events
      .flatMap((event) =>
        generateOccurrences(
          event.start,
          event.end,
          event.recurrenceRule,
          start,
          end,
          event.recurrenceTimezone || res.locals.calendar.timezone,
          event.excludedDates,
        ).map((occurrence) => ({ ...event, ...occurrence })),
      )
      .sort((a, b) => +a.start - +b.start),
  );
});
app.get(`${prefix}/events/:id`, async (req, res) =>
  res.json(await findEvent(req, res)),
);
async function eventData(body: Record<string, unknown>, calendarId: string) {
  const title = text(body.title, "Titel", 200),
    start = date(body.start),
    end = date(body.end);
  if (end <= start || +end - +start > 366 * 86400000)
    fail(400, "De eindtijd moet na de begintijd liggen (maximaal één jaar).");
  const recurrenceRule = body.recurrenceRule
    ? text(body.recurrenceRule, "Herhaling", 500)
    : null;
  try {
    parseRecurrenceRule(recurrenceRule);
  } catch {
    fail(400, "Ongeldige herhalingsregel.");
  }
  if (
    !Array.isArray(body.people) ||
    body.people.some((x) => typeof x !== "string") ||
    body.people.length > 100
  )
    fail(400, "Ongeldige personenlijst.");
  const ids = [...new Set(body.people as string[])];
  if (
    (await prisma.person.count({ where: { id: { in: ids }, calendarId } })) !==
    ids.length
  )
    fail(400, "Een persoon hoort niet bij deze agenda.");
  const reminderMinutes = body.reminderMinutes ?? null;
  if (
    reminderMinutes !== null &&
    (!Number.isInteger(reminderMinutes) ||
      Number(reminderMinutes) < 0 ||
      Number(reminderMinutes) > 10080)
  )
    fail(400, "Ongeldige herinnering.");
  const optional = (value: unknown, max: number) =>
    value == null || value === "" ? null : text(value, "Tekst", max);
  return {
    title,
    start,
    end,
    recurrenceTimezone: null,
    location: optional(body.location, 500),
    notes: optional(body.notes, 20000),
    recurrenceRule,
    reminderMinutes: reminderMinutes as number | null,
    people: { create: ids.map((personId) => ({ personId })) },
  };
}
app.post(`${prefix}/events`, async (req, res) =>
  res.status(201).json(
    await prisma.event.create({
      data: {
        ...(await eventData(req.body, res.locals.calendar.id)),
        calendarId: res.locals.calendar.id,
      },
      include,
    }),
  ),
);
app.patch(`${prefix}/events/:id`, async (req, res) => {
  const existing = await findEvent(req, res);
  if (existing.feedId) fail(403, "Bewerk deze afspraak in de externe agenda.");
  const data = await eventData(
    {
      ...existing,
      people: existing.people.map((p) => p.personId),
      ...req.body,
    },
    res.locals.calendar.id,
  );
  res.json(
    await prisma.event.update({
      where: { id: existing.id },
      data: { ...data, people: { deleteMany: {}, ...data.people } },
      include,
    }),
  );
});
app.post(`${prefix}/events/:id/occurrences`, async (req, res) => {
  const event = await findEvent(req, res);
  if (req.method !== "GET" && event.feedId)
    fail(403, "Bewerk deze afspraak in de externe agenda.");
  const occurrence = date(req.body.occurrence);
  if (
    !event.recurrenceRule ||
    !generateOccurrences(
      event.start,
      event.end,
      event.recurrenceRule,
      occurrence,
      new Date(+occurrence + 1),
      event.recurrenceTimezone || res.locals.calendar.timezone,
      event.excludedDates,
    ).some((x) => +x.start === +occurrence)
  )
    fail(400, "Dit voorkomen bestaat niet.");
  const data = await eventData(
    { ...req.body, recurrenceRule: null },
    res.locals.calendar.id,
  );
  const updated = await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: event.id },
      data: { excludedDates: { push: occurrence.toISOString() } },
    });
    const created = await tx.event.create({
      data: { ...data, calendarId: res.locals.calendar.id },
      include,
    });
    const files = await tx.attachment.findMany({
      where: { eventId: event.id },
    });
    for (const file of files)
      await tx.attachment.create({
        data: {
          eventId: created.id,
          name: file.name,
          data: file.data,
          size: file.size,
        },
      });
    return created;
  });
  res.status(201).json(updated);
});
app.delete(`${prefix}/events/:id`, async (req, res) => {
  const event = await findEvent(req, res);
  if (req.method !== "GET" && event.feedId)
    fail(403, "Bewerk deze afspraak in de externe agenda.");
  if (req.query.occurrence) {
    const occurrence = date(req.query.occurrence);
    const match = generateOccurrences(
      event.start,
      event.end,
      event.recurrenceRule,
      occurrence,
      new Date(+occurrence + 1),
      event.recurrenceTimezone || res.locals.calendar.timezone,
      event.excludedDates,
    ).some((x) => +x.start === +occurrence);
    if (!event.recurrenceRule || !match)
      fail(400, "Dit voorkomen bestaat niet.");
    await prisma.event.update({
      where: { id: event.id },
      data: { excludedDates: { push: occurrence.toISOString() } },
    });
  } else await prisma.event.delete({ where: { id: event.id } });
  res.status(204).end();
});
app.post(`${prefix}/events/:id/files`, async (req, res) => {
  const event = await findEvent(req, res);
  if (req.method !== "GET" && event.feedId)
    fail(403, "Bewerk deze afspraak in de externe agenda.");
  const name = text(req.body.name, "Bestandsnaam", 200).replace(
    /[\\/\r\n]/g,
    "_",
  );
  if (
    typeof req.body.data !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(req.body.data)
  )
    fail(400, "Ongeldig bestand.");
  const data = Buffer.from(req.body.data, "base64");
  if (!data.length || data.length > 5 * 1024 * 1024)
    fail(400, "Bestanden mogen maximaal 5 MB groot zijn.");
  if (event.attachments.length >= 10)
    fail(400, "Maximaal 10 bestanden per afspraak.");
  res.status(201).json(
    await prisma.attachment.create({
      data: { eventId: event.id, name, data, size: data.length },
      select: { id: true, name: true, size: true },
    }),
  );
});
app.get(`${prefix}/events/:id/files/:fileId`, async (req, res) => {
  const event = await findEvent(req, res);
  if (req.method !== "GET" && event.feedId)
    fail(403, "Bewerk deze afspraak in de externe agenda.");
  const file = await prisma.attachment.findFirst({
    where: { id: String(req.params.fileId), eventId: event.id },
  });
  if (!file) fail(404, "Bestand niet gevonden.");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file!.name)}`,
  );
  res.type("application/octet-stream").send(Buffer.from(file!.data));
});
app.delete(`${prefix}/events/:id/files/:fileId`, async (req, res) => {
  const event = await findEvent(req, res);
  if (req.method !== "GET" && event.feedId)
    fail(403, "Bewerk deze afspraak in de externe agenda.");
  await prisma.attachment.deleteMany({
    where: { id: String(req.params.fileId), eventId: event.id },
  });
  res.status(204).end();
});
app.post(`${prefix}/import`, async (req, res) => {
  const source = text(req.body.content, "Agendabestand", 2 * 1024 * 1024);
  let data: ReturnType<typeof importCalendar>;
  try {
    data = importCalendar(source, res.locals.calendar.timezone);
  } catch (error) {
    return fail(
      400,
      error instanceof Error ? error.message : "Ongeldig agendabestand.",
    );
  }
  await prisma.$transaction(
    data.map((event) =>
      prisma.event.upsert({
        where: {
          calendarId_externalUid: {
            calendarId: res.locals.calendar.id,
            externalUid: event.externalUid,
          },
        },
        create: { ...event, calendarId: res.locals.calendar.id },
        update: event,
      }),
    ),
  );
  res.json({ count: data.length });
});
app.get(`${prefix}/export`, async (_req, res) => {
  const events = await prisma.event.findMany({
    where: { calendarId: res.locals.calendar.id },
  });
  res.setHeader("Content-Disposition", "attachment; filename=zenda.ics");
  res
    .type("text/calendar")
    .send(exportCalendar(events, res.locals.calendar.timezone));
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError)
    return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError)
    return res.status(400).json({ error: "Ongeldige invoer." });
  if ((error as { type?: string })?.type === "entity.too.large")
    return res.status(413).json({ error: "Het bestand is te groot." });
  console.error(error);
  res.status(500).json({
    error:
      "De actie is niet gelukt. Controleer de server en database en probeer opnieuw.",
  });
});
if (require.main === module)
  app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || "127.0.0.1",
    () => {
      console.log("Zenda API gestart");
      startReminders();
      startFeedSync();
    },
  );

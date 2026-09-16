import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
await new Promise((resolve, reject) => {
  const check = createServer();
  check.once("error", () =>
    reject(
      new Error(
        "Stop de lokale API voordat je de tijdelijke browserfixture start.",
      ),
    ),
  );
  check.listen(3001, "127.0.0.1", () => check.close(resolve));
});
const db = await PGlite.create();
for (const name of (await readdir("prisma/migrations")).sort())
  if (name.startsWith("20"))
    await db.exec(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
const socket = new PGLiteSocketServer({ db, port: 55432, host: "127.0.0.1" });
await socket.start();
const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: {
    ...process.env,
    DATABASE_URL: "postgresql://test:test@127.0.0.1:55432/postgres",
    DB_POOL_MAX: "1",
    PORT: "3001",
    APP_ORIGIN: "http://localhost:3002,http://127.0.0.1:3002",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
  },
  stdio: "inherit",
  windowsHide: true,
});
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch("http://127.0.0.1:3001/api/health");
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
async function call(path, method = "GET", body, cookie = "") {
  const r = await fetch("http://127.0.0.1:3001/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return {
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
const owner = await call("/auth/register", "POST", {
  name: "David",
  email: "demo@zenda.test",
  password: "Zenda-demo-2026!",
});
const calendar = (await call("/calendars", "GET", undefined, owner.cookie))
  .body[0];
const p = "/calendars/" + calendar.id;
await call(p, "PATCH", { name: "Familie de Vries" }, owner.cookie);
await call(
  p + "/users",
  "POST",
  {
    name: "Sam",
    email: "sam@zenda.test",
    password: "Zenda-demo-2026!",
    role: "EDIT",
  },
  owner.cookie,
);
const people = [];
for (const [name, initials, color] of [
  ["David", "DA", "#588875"],
  ["Sam", "SA", "#bf8098"],
  ["Lina", "LI", "#bc914f"],
])
  people.push(
    (await call(p + "/people", "POST", { name, initials, color }, owner.cookie))
      .body,
  );
const now = new Date();
const monday = new Date(now);
monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
for (const [offset, title, time, ids] of [
  [0, "Samen ontbijten", 8, [0, 1, 2]],
  [1, "Voetbaltraining", 16, [2]],
  [2, "Tandarts", 10, [0, 2]],
  [2, "Boodschappen", 17, [1]],
  [3, "Ouderavond", 19, [0, 1]],
  [4, "Filmavond", 19, [0, 1, 2]],
  [5, "Bij oma op bezoek", 13, [0, 1, 2]],
]) {
  const start = new Date(monday);
  start.setHours(time, 0, 0, 0);
  start.setDate(monday.getDate() + offset);
  await call(
    p + "/events",
    "POST",
    {
      title,
      start: start.toISOString(),
      end: new Date(+start + 3600000).toISOString(),
      people: ids.map((i) => people[i].id),
    },
    owner.cookie,
  );
}
await db.query(
  'INSERT INTO "CalendarFeed" (id,"calendarId","ownerId",name,url,color) VALUES ($1,$2,$3,$4,$5,$6)',
  [
    "demo-feed",
    calendar.id,
    owner.body.id,
    "Werk David",
    "https://127.0.0.1/example.ics",
    "#617fb4",
  ],
);
const start = new Date(monday);
start.setDate(monday.getDate() + 3);
start.setHours(9, 0, 0, 0);
await db.query(
  'INSERT INTO "Event" (id,title,start,"end","calendarId","feedId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())',
  [
    "demo-work",
    "Teamoverleg",
    start.toISOString(),
    new Date(+start + 3600000).toISOString(),
    calendar.id,
    "demo-feed",
  ],
);
console.log(
  "Disposable browser fixture ready. Demo account only in temporary memory.",
);
async function stop() {
  child.kill();
  await socket.stop();
  await db.close();
  process.exit();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

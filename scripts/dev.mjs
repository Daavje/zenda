import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(path.join(root, "api/package.json"));
const external = process.argv.includes("--external");
const children = [];
let database, socket;
const env = { ...process.env };
for (const port of [3000, 3001]) {
  await new Promise((resolve, reject) => {
    const check = createServer();
    check.once("error", () =>
      reject(
        new Error(
          `Poort ${port} is al in gebruik. Stop de eerdere Zenda-server voordat je opnieuw start.`,
        ),
      ),
    );
    check.listen(port, "127.0.0.1", () => check.close(resolve));
  });
}
await mkdir(path.join(root, ".local"), { recursive: true });
if (!external) {
  env.HOST = "127.0.0.1";
  env.PORT = "3001";
  env.API_URL = "http://127.0.0.1:3001";
  env.APP_ORIGIN = "http://localhost:3000,http://127.0.0.1:3000";
  env.NODE_ENV = "development";
  const { PGlite } = apiRequire("@electric-sql/pglite");
  const { PGLiteSocketServer } = apiRequire("@electric-sql/pglite-socket");
  database = await PGlite.create(path.join(root, ".local/database"));
  await database.exec(
    "CREATE TABLE IF NOT EXISTS zenda_local_migrations (name TEXT PRIMARY KEY)",
  );
  const migrations = path.join(root, "api/prisma/migrations");
  for (const name of (await readdir(migrations)).sort()) {
    if (!name.startsWith("20")) continue;
    const exists = await database.query(
      "SELECT name FROM zenda_local_migrations WHERE name = $1",
      [name],
    );
    if (exists.rows.length) continue;
    await database.transaction(async (tx) => {
      await tx.exec(
        await readFile(path.join(migrations, name, "migration.sql"), "utf8"),
      );
      await tx.query("INSERT INTO zenda_local_migrations(name) VALUES ($1)", [
        name,
      ]);
    });
  }
  socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 55434,
  });
  await socket.start();
  env.DATABASE_URL = "postgresql://local:local@127.0.0.1:55434/postgres";
  env.DB_POOL_MAX = "1";
  console.log(
    "Lokale gegevens worden bewaard in .local/database. Bestaande PostgreSQL-data blijft ongewijzigd.",
  );
}
const vapidPath = path.join(root, ".local/vapid.json");
let vapid;
try {
  vapid = JSON.parse(await readFile(vapidPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  vapid = apiRequire("web-push").generateVAPIDKeys();
  await writeFile(vapidPath, JSON.stringify(vapid), { mode: 0o600 });
}
if (!env.VAPID_PUBLIC_KEY && !external) {
  env.VAPID_PUBLIC_KEY = vapid.publicKey;
  env.VAPID_PRIVATE_KEY = vapid.privateKey;
  env.VAPID_SUBJECT = "mailto:local@zenda.invalid";
}
function launch(args, cwd, overrides = {}) {
  const child = spawn(process.execPath, args, {
    cwd: path.join(root, cwd),
    env: { ...env, ...overrides },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !stopping) {
      console.error(`Proces gestopt (${code}).`);
      void stop(1);
    }
  });
  return child;
}
let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (socket) await socket.stop();
  if (database) await database.close();
  process.exit(exitCode);
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
launch(["--import", "tsx", "src/server.ts"], "api");
launch(
  ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"],
  "web",
  { PORT: "3000" },
);
console.log(
  "Open http://localhost:3000 en maak je eigen account. Stop met Ctrl+C.",
);

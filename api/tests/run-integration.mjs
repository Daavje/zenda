import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
async function database(port) {
  const db = await PGlite.create();
  for (const name of (await readdir("prisma/migrations")).sort())
    if (name.startsWith("20"))
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  const socket = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await socket.start();
  return {
    close: async () => {
      await socket.stop();
      await db.close();
    },
  };
}
const storage = await database(55433);
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://test:test@127.0.0.1:55433/postgres",
  DB_POOL_MAX: "1",
  PORT: "3011",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
};
const api = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let logs = "";
api.stdout.on("data", (data) => (logs += data));
api.stderr.on("data", (data) => (logs += data));
async function stopApi() {
  if (api.exitCode !== null || api.signalCode !== null) return;
  const stopped = once(api, "exit");
  api.kill();
  await stopped;
}
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("API startup timed out: " + logs)),
      20000,
    );
    api.stdout.on("data", (data) => {
      if (String(data).includes("gestart")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    api.on("exit", () => {
      clearTimeout(timeout);
      reject(new Error(logs));
    });
  });
  const runner = spawn(process.execPath, ["tests/integration.mjs"], {
    env: { ...env, TEST_API_URL: "http://127.0.0.1:3011/api" },
    stdio: "inherit",
    windowsHide: true,
  });
  const [code] = await once(runner, "exit");
  if (code) {
    console.error(logs);
    process.exitCode = 1;
  }
} finally {
  await stopApi();
  await storage.close();
}
if (!process.exitCode) {
  const remindersStorage = await database(55435);
  try {
    const reminders = spawn(
      process.execPath,
      ["--import", "tsx", "tests/reminders.ts"],
      {
        env: {
          ...env,
          DATABASE_URL: "postgresql://test:test@127.0.0.1:55435/postgres",
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    const [code] = await once(reminders, "exit");
    if (code) process.exitCode = 1;
  } finally {
    await remindersStorage.close();
  }
}

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
const db = await PGlite.create();
for (const name of (await readdir("prisma/migrations")).sort()) {
  if (name.startsWith("20")) await db.exec(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
}
const server = new PGLiteSocketServer({ db, port: 55432, host: "127.0.0.1" });
await server.start();
console.log("Isolated test PostgreSQL on 55432; no existing data used.");

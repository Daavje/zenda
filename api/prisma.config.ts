import { defineConfig } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // Generation and validation also run before a database is configured.
    url:
      process.env.DATABASE_URL ??
      "postgresql://unused:unused@127.0.0.1:1/unused",
  },
});

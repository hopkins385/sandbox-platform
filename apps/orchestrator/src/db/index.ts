import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import * as schema from "./schema.js";

const DB_PATH = path.resolve(process.env.DB_PATH ?? "./orchestrator.db");

export const db = drizzle({
  connection: { url: `file:${DB_PATH}` },
  schema,
});

await migrate(db, {
  migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle"),
});

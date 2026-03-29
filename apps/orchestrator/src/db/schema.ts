import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apps = sqliteTable("apps", {
  id:        text("id").primaryKey(),
  slug:      text("slug").notNull(),
  name:      text("name").notNull(),
  ownerId:   text("owner_id").notNull(),
  status:    text("status", { enum: ["creating", "running", "stopped", "error"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;

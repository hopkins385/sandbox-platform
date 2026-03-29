import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import {
  spawnContainer,
  destroyContainer,
  recreateContainer,
  recreateAllContainers,
} from "../container.js";
import { reconnectWorkerSessions, markAppRestarting, unmarkAppRestarting } from "./sessions.js";
import type { App, AppListResponse } from "@sandbox/types";

export function rowToApp(row: typeof apps.$inferSelect): App {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerId: row.ownerId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const appsRouter = new Hono();

appsRouter.get("/", async (c) => {
  const rows = await db.select().from(apps);
  const response: AppListResponse = {
    owned: rows.map(rowToApp),
    collaborations: [],
  };
  return c.json(response);
});

appsRouter.post("/", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name ?? "New App";
  const now = new Date().toISOString();

  const [record] = await db
    .insert(apps)
    .values({
      id: crypto.randomUUID(),
      slug: slugify(name),
      name,
      ownerId: (c.get("userId" as never) as string) ?? "anonymous",
      status: "creating",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  spawnContainer(record.id).catch(async (err) => {
    console.error(
      `[orchestrator] Failed to start container for app ${record.id}:`,
      err,
    );
    await db
      .update(apps)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(apps.id, record.id));
  });

  return c.json(rowToApp(record), 201);
});

appsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const [record] = await db.select().from(apps).where(eq(apps.id, id));
  if (!record) return c.json({ error: "App not found" }, 404);

  await destroyContainer(id).catch((err) =>
    console.warn(`[orchestrator] Error removing container for app ${id}:`, err),
  );

  await db.delete(apps).where(eq(apps.id, id));
  return c.json({ deleted: true, id });
});

appsRouter.post("/:id/collaborators", async (c) => {
  const body = await c.req.json();
  return c.json({ added: true, appId: c.req.param("id"), ...body });
});

appsRouter.post("/:id/restart", async (c) => {
  const id = c.req.param("id");
  const [record] = await db.select().from(apps).where(eq(apps.id, id));
  if (!record) return c.json({ error: "App not found" }, 404);

  markAppRestarting(id);
  recreateContainer(id)
    .then(() => reconnectWorkerSessions(id)) // clears restartingApps in its finally
    .catch(async (err) => {
      unmarkAppRestarting(id);
      console.error(
        `[orchestrator] Failed to recreate container for app ${id}:`,
        err,
      );
      await db
        .update(apps)
        .set({ status: "error", updatedAt: new Date().toISOString() })
        .where(eq(apps.id, id));
    });

  return c.json({ restarting: true, id });
});

appsRouter.post("/restart-all", async (c) => {
  const results = await recreateAllContainers();
  return c.json({ results });
});

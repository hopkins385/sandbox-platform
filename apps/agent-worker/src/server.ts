import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "@sandbox/logger";
import { WORKER_SECRET, PORT } from "./config.js";
import { connectToOrchestrator } from "./ws.js";

const app = new Hono();

// Authenticate all mutating endpoints with a shared secret. /health is exempt
// so Docker/k8s probes don't need credentials.
app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${WORKER_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

app.get("/health", (c) => c.json({ ok: true }));

// POST /connect  { sessionId }
// Fire-and-forget: returns 204 immediately and connects in the background.
app.post("/connect", async (c) => {
  const { sessionId } = await c.req.json<{ sessionId: string }>();
  if (!sessionId || typeof sessionId !== "string") {
    return c.text("Invalid sessionId", 400);
  }
  connectToOrchestrator(sessionId);
  return c.body(null, 204);
});

export function startServer() {
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    logger.info(`[agent-worker] listening on :${PORT}`);
  });

  server.on("error", (err) => {
    logger.error("[agent-worker] Server error:", err);
    process.exit(1);
  });
}

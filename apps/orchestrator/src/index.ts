import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { reconcileApps } from "./container.js";
import { appsRouter } from "./routes/apps.js";
import { sessionsRouter } from "./routes/sessions.js";

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:3001" }));

app.use("*", async (c, next) => {
  const userId = c.req.header("x-user-id");
  if (userId) c.set("userId" as never, userId);
  await next();
});

app.route("/api/apps", appsRouter);
app.route("/api/sessions", sessionsRouter);

const PORT = 4000;
reconcileApps().then(() => {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Orchestrator running on :${PORT}`);
  });
});

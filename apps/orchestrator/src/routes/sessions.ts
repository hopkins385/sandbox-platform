import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { inspectPorts } from "../container.js";
import { workerUrl, workerAuthHeaders } from "../worker.js";
import { rowToApp } from "./apps.js";
import type {
  SessionOpenRequest,
  SessionOpenResponse,
  SendMessageRequest,
  CancelMessageRequest,
  CancelMessageResponse,
  AnswerMessageRequest,
  AnswerMessageResponse,
} from "@sandbox/types";

interface SessionRecord {
  id: string;
  appId: string;
  port4001: number;
  createdAt: string;
}

const sessionStore = new Map<string, SessionRecord>();

export const sessionsRouter = new Hono();

sessionsRouter.post("/open", async (c) => {
  const body = await c.req.json<SessionOpenRequest>();
  const [record] = await db.select().from(apps).where(eq(apps.id, body.appId));
  if (!record) return c.json({ error: "App not found" }, 404);
  if (record.status !== "running") return c.json({ error: "Container not ready" }, 503);

  const { port3000, port4001 } = await inspectPorts(record.id);

  const sessionId = crypto.randomUUID();
  sessionStore.set(sessionId, { id: sessionId, appId: record.id, port4001, createdAt: new Date().toISOString() });

  const response: SessionOpenResponse = {
    sessionId,
    app: rowToApp(record),
    previewUrl: `http://localhost:${port3000}`,
  };
  return c.json(response);
});

sessionsRouter.post("/send", async (c) => {
  const body = await c.req.json<SendMessageRequest>();
  const session = sessionStore.get(body.sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const workerRes = await fetch(`${workerUrl(session.port4001)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
    body: JSON.stringify({ runId: session.id, prompt: body.message }),
  });

  if (!workerRes.ok || !workerRes.body) {
    return c.json({ error: "Worker request failed" }, 502);
  }

  const workerBody = workerRes.body;
  return streamSSE(c, async (stream) => {
    const reader = workerBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data) await stream.writeSSE({ data });
          }
        }
      }
      if (buffer.startsWith("data:")) {
        const data = buffer.slice(5).trim();
        if (data) await stream.writeSSE({ data });
      }
    } finally {
      reader.releaseLock();
    }
  });
});

sessionsRouter.post("/close", (c) => c.json({ closed: true }));

sessionsRouter.post("/cancel", async (c) => {
  const { sessionId } = await c.req.json<CancelMessageRequest>();
  const session = sessionStore.get(sessionId);
  if (!session) return c.json({ cancelled: false } satisfies CancelMessageResponse);

  await fetch(`${workerUrl(session.port4001)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
    body: JSON.stringify({ runId: sessionId }),
  }).catch((err) =>
    console.warn(`[orchestrator] Cancel failed for session ${sessionId}:`, err),
  );

  return c.json({ cancelled: true } satisfies CancelMessageResponse);
});

sessionsRouter.post("/answer", async (c) => {
  const { sessionId, answers } = await c.req.json<AnswerMessageRequest>();
  const session = sessionStore.get(sessionId);
  if (!session) return c.json({ delivered: false } satisfies AnswerMessageResponse, 404);

  const res = await fetch(`${workerUrl(session.port4001)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
    body: JSON.stringify({ runId: sessionId, answers }),
  }).catch((err) => {
    console.warn(`[orchestrator] Answer failed for session ${sessionId}:`, err);
    return null;
  });

  if (!res?.ok) return c.json({ delivered: false } satisfies AnswerMessageResponse, 502);
  return c.json({ delivered: true } satisfies AnswerMessageResponse);
});

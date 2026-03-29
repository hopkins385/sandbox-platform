import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { UpgradeWebSocket } from "hono/ws";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { inspectPorts } from "../container.js";
import { workerUrl, workerAuthHeaders } from "../worker.js";
import { rowToApp } from "./apps.js";
import type {
  SessionOpenRequest,
  SessionOpenResponse,
  WsClientMessage,
  SendMessageResponse,
} from "@sandbox/types";
import { logger } from "@sandbox/logger";

interface SessionRecord {
  id: string;
  appId: string;
  port4001: number;
  createdAt: string;
}

const sessionStore = new Map<string, SessionRecord>();

export function createSessionsRouter(upgradeWebSocket: UpgradeWebSocket) {
  const router = new Hono();

  router.post("/open", async (c) => {
    const body = await c.req.json<SessionOpenRequest>();
    const [record] = await db
      .select()
      .from(apps)
      .where(eq(apps.id, body.appId));
    if (!record) return c.json({ error: "App not found" }, 404);
    if (record.status !== "running")
      return c.json({ error: "Container not ready" }, 503);

    const { port3000, port4001 } = await inspectPorts(record.id);

    const sessionId = crypto.randomUUID();
    sessionStore.set(sessionId, {
      id: sessionId,
      appId: record.id,
      port4001,
      createdAt: new Date().toISOString(),
    });

    const response: SessionOpenResponse = {
      sessionId,
      app: rowToApp(record),
      previewUrl: `http://localhost:${port3000}`,
    };
    return c.json(response);
  });

  // GET /ws/:sessionId — WebSocket endpoint for streaming agent interactions
  router.get(
    "/ws/:sessionId",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("sessionId") ?? "";

      // Tracks the active run so it can be aborted on browser disconnect or cancel
      let activeAbort: AbortController | null = null;

      const emit = (
        ws: { send: (data: string) => void },
        msg: SendMessageResponse,
      ) => {
        ws.send(JSON.stringify(msg));
      };

      // Runs the worker SSE stream detached from onMessage so the handler
      // returns immediately. The AbortController lets onClose/cancel kill it.
      async function pipeWorkerRun(
        ws: { send: (data: string) => void },
        session: SessionRecord,
        prompt: string,
      ) {
        const abort = new AbortController();
        activeAbort = abort;

        let workerRes: Response;
        try {
          workerRes = await fetch(`${workerUrl(session.port4001)}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              ...workerAuthHeaders(),
            },
            body: JSON.stringify({ runId: sessionId, prompt }),
            signal: abort.signal,
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          emit(ws, {
            type: "error",
            content: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        if (!workerRes.ok || !workerRes.body) {
          emit(ws, { type: "error", content: "Worker request failed" });
          return;
        }

        const reader = workerRes.body.getReader();
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
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              try {
                emit(ws, JSON.parse(data) as SendMessageResponse);
              } catch {
                // skip malformed frames
              }
            }
          }
          if (buffer.startsWith("data:")) {
            const data = buffer.slice(5).trim();
            if (data) {
              try {
                emit(ws, JSON.parse(data) as SendMessageResponse);
              } catch {
                // ignore
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            emit(ws, {
              type: "error",
              content: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } finally {
          reader.releaseLock();
          activeAbort = null;
        }
      }

      return {
        onMessage(event, ws) {
          let msg: WsClientMessage;
          try {
            msg = JSON.parse(event.data as string) as WsClientMessage;
          } catch {
            return;
          }

          const session = sessionStore.get(sessionId);
          if (!session) {
            emit(ws, { type: "error", content: "Session not found" });
            return;
          }

          if (msg.type === "send") {
            logger.info(
              `[orchestrator] WS send for session ${sessionId}: ${msg.message}`,
            );
            // Fire-and-forget — returns immediately, streams in background
            pipeWorkerRun(ws, session, msg.message).catch((err) =>
              logger.error(`[orchestrator] Unexpected pipe error:`, err),
            );
          } else if (msg.type === "cancel") {
            activeAbort?.abort();
            fetch(`${workerUrl(session.port4001)}/cancel`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...workerAuthHeaders(),
              },
              body: JSON.stringify({ runId: sessionId }),
            }).catch((err) =>
              logger.warn(
                `[orchestrator] Cancel failed for session ${sessionId}:`,
                err,
              ),
            );
          } else if (msg.type === "answer") {
            fetch(`${workerUrl(session.port4001)}/answer`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...workerAuthHeaders(),
              },
              body: JSON.stringify({ runId: sessionId, answers: msg.answers }),
            }).catch((err) =>
              logger.warn(
                `[orchestrator] Answer failed for session ${sessionId}:`,
                err,
              ),
            );
          }
        },

        onClose() {
          logger.debug(`[orchestrator] WS closed for session ${sessionId}`);
          // Abort any active run when the browser disconnects
          activeAbort?.abort();
        },

        onError(event) {
          logger.error(
            `[orchestrator] WS error for session ${sessionId}:`,
            event,
          );
        },
      };
    }),
  );

  router.post("/close", (c) => c.json({ closed: true }));

  return router;
}

interface SessionRecord {
  id: string;
  appId: string;
  port4001: number;
  createdAt: string;
}

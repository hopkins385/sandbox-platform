import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { UpgradeWebSocket } from "hono/ws";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { inspectPorts } from "../container.js";
import { workerUrl, workerAuthHeaders, waitForWorker } from "../worker.js";
import type {
  SessionOpenRequest,
  SessionOpenResponse,
  WsClientMessage,
  SendMessageResponse,
  App,
} from "@sandbox/types";
import { logger } from "@sandbox/logger";

function rowToApp(row: typeof apps.$inferSelect): App {
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

// Minimal interface for a connected WS peer so we don't depend on a specific WS class
interface WsPeer {
  send(data: string): void;
}

interface SessionRecord {
  id: string;
  appId: string;
  port4001: number;
  createdAt: string;
  browserWs: WsPeer | null;
  workerWs: WsPeer | null;
}

const sessionStore = new Map<string, SessionRecord>();

// Apps whose containers are being intentionally restarted via the API.
// While an app is in this set the onClose auto-reconnect is suppressed so that
// reconnectWorkerSessions (which knows the new port) handles it exclusively.
const restartingApps = new Set<string>();

export function markAppRestarting(appId: string): void {
  restartingApps.add(appId);
}

export function unmarkAppRestarting(appId: string): void {
  restartingApps.delete(appId);
}

/**
 * Called after a container is recreated. Clears the stale worker WS for every
 * active session belonging to that app and re-calls /connect on the new worker
 * so it rejoins the session channel.
 */
export async function reconnectWorkerSessions(appId: string): Promise<void> {
  try {
    const { port4001 } = await inspectPorts(appId);
    for (const [sessionId, session] of sessionStore) {
      if (session.appId !== appId) continue;
      session.workerWs = null;
      session.port4001 = port4001;
      session.browserWs?.send(
        JSON.stringify({
          type: "worker_disconnected",
          content: "",
        } satisfies SendMessageResponse),
      );
      fetch(`${workerUrl(appId, port4001)}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
        body: JSON.stringify({ sessionId }),
      }).catch((err) =>
        logger.warn(
          `[orchestrator] /connect re-call failed for session ${sessionId} after restart:`,
          err,
        ),
      );
    }
  } finally {
    restartingApps.delete(appId);
  }
}

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
      browserWs: null,
      workerWs: null,
    });

    // Tell the worker to connect back to us on this session's WS channel
    fetch(`${workerUrl(record.id, port4001)}/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...workerAuthHeaders(),
      },
      body: JSON.stringify({ sessionId }),
    }).catch((err) =>
      logger.warn(
        `[orchestrator] /connect call failed for session ${sessionId}:`,
        err,
      ),
    );

    const response: SessionOpenResponse = {
      sessionId,
      app: rowToApp(record),
      previewUrl: `http://localhost:${port3000}`,
    };
    return c.json(response);
  });

  // GET /ws/:sessionId — WebSocket endpoint for both the browser and the worker.
  // The first message determines the peer role:
  //   - Worker sends: { type: "auth", token: WORKER_SECRET }
  //   - Browser sends its first WsClientMessage directly (no auth step)
  // After identification all messages are forwarded to the other peer.
  router.get(
    "/ws/:sessionId",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("sessionId") ?? "";
      let role: "browser" | "worker" | null = null;

      return {
        onMessage(event, ws) {
          const rawData = event.data as string;
          const session = sessionStore.get(sessionId);

          // First message: identify the peer
          if (role === null) {
            let firstMsg: Record<string, unknown>;
            try {
              firstMsg = JSON.parse(rawData) as Record<string, unknown>;
            } catch {
              return;
            }

            if (
              firstMsg["type"] === "auth" &&
              firstMsg["token"] === process.env.WORKER_SECRET
            ) {
              role = "worker";
              if (session) {
                session.workerWs = ws;
                session.browserWs?.send(
                  JSON.stringify({
                    type: "worker_connected",
                    content: "",
                  } satisfies SendMessageResponse),
                );
              }
              logger.info(
                `[orchestrator] Worker connected for session ${sessionId}`,
              );
              return;
            }

            // Not an auth message — treat as browser
            role = "browser";
            if (session) {
              session.browserWs = ws;
              // Worker may have connected before the browser WS was established
              if (session.workerWs) {
                ws.send(
                  JSON.stringify({
                    type: "worker_connected",
                    content: "",
                  } satisfies SendMessageResponse),
                );
              }
            }
            // Fall through to process the message as a browser message
          }

          if (!session) {
            ws.send(
              JSON.stringify({
                type: "error",
                content: "Session not found",
              } satisfies SendMessageResponse),
            );
            return;
          }

          if (role === "browser") {
            let msg: WsClientMessage;
            try {
              msg = JSON.parse(rawData) as WsClientMessage;
            } catch {
              return;
            }

            if (msg.type === "ping") {
              // Silently forward to worker if connected; ignore otherwise
              // (worker_connected will arrive when the worker joins)
              session.workerWs?.send(rawData);
              return;
            }

            // Forward browser → worker
            if (!session.workerWs) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  content: "AI Agent not connected",
                } satisfies SendMessageResponse),
              );
              return;
            }
            if (msg.type === "send") {
              logger.info(
                `[orchestrator] Browser send for session ${sessionId}: ${msg.message}`,
              );
            }
            session.workerWs.send(rawData);
          } else {
            // role === "worker": forward worker → browser
            if (session.browserWs) {
              session.browserWs.send(rawData);
            }
          }
        },

        onClose() {
          const session = sessionStore.get(sessionId);
          if (role === "browser") {
            logger.debug(
              `[orchestrator] Browser WS closed for session ${sessionId}`,
            );
            if (session) {
              // Tell the worker to cancel any active run
              session.workerWs?.send(
                JSON.stringify({ type: "cancel" } satisfies WsClientMessage),
              );
              session.browserWs = null;
            }
          } else if (role === "worker") {
            logger.debug(
              `[orchestrator] Worker WS closed for session ${sessionId}`,
            );
            if (session) {
              session.browserWs?.send(
                JSON.stringify({
                  type: "worker_disconnected",
                  content: "",
                } satisfies SendMessageResponse),
              );
              session.workerWs = null;
              // If the browser is still connected and this is NOT an intentional
              // API restart (which calls reconnectWorkerSessions itself), the
              // container may have self-restarted — poll the worker and reconnect.
              if (session.browserWs && !restartingApps.has(session.appId)) {
                waitForWorker(session.appId, session.port4001)
                  .then(() => {
                    if (!session.browserWs) return; // browser left while we waited
                    fetch(`${workerUrl(session.appId, session.port4001)}/connect`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
                      body: JSON.stringify({ sessionId }),
                    }).catch((err) =>
                      logger.warn(
                        `[orchestrator] Auto-reconnect /connect failed for session ${sessionId}:`,
                        err,
                      ),
                    );
                  })
                  .catch(() =>
                    logger.warn(
                      `[orchestrator] Worker did not recover for session ${sessionId}`,
                    ),
                  );
              }
            }
          }
        },

        onError(event) {
          logger.error(
            `[orchestrator] WS error for session ${sessionId} (${role ?? "unknown"}):`,
            event,
          );
        },
      };
    }),
  );

  router.post("/close", (c) => c.json({ closed: true }));

  return router;
}

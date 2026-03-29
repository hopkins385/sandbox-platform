import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { inspectPorts } from "../container.js";
import { workerUrl, workerAuthHeaders, waitForWorker } from "../worker.js";
import type {
  SessionOpenRequest,
  SessionOpenResponse,
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

interface SessionRecord {
  id: string;
  appId: string;
  port4001: number;
  createdAt: string;
}

const sessionStore = new Map<string, SessionRecord>();
const restartingApps = new Set<string>();

let _io: Server;

export function markAppRestarting(appId: string): void {
  restartingApps.add(appId);
}

export function unmarkAppRestarting(appId: string): void {
  restartingApps.delete(appId);
}

export async function reconnectWorkerSessions(appId: string): Promise<void> {
  try {
    const { port4001 } = await inspectPorts(appId);
    for (const [sessionId, session] of sessionStore) {
      if (session.appId !== appId) continue;
      session.port4001 = port4001;
      _io.to(sessionId).emit("worker_disconnected", "");
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

export function registerSocketHandlers(io: Server): void {
  _io = io;

  io.use((socket, next) => {
    const { role, sessionId, token } = socket.handshake.auth as {
      role: string;
      sessionId: string;
      token?: string;
    };

    if (!sessionId || !role)
      return next(new Error("Missing sessionId or role"));

    if (role === "worker") {
      if (token !== process.env.WORKER_SECRET)
        return next(new Error("Unauthorized"));
    }

    if (!sessionStore.has(sessionId))
      return next(new Error("Session not found"));

    socket.data.role = role as "browser" | "worker";
    socket.data.sessionId = sessionId;
    next();
  });

  io.on("connection", (socket) => {
    const { role, sessionId } = socket.data as {
      role: "browser" | "worker";
      sessionId: string;
    };

    socket.join(sessionId);

    if (role === "worker") {
      logger.info(`[orchestrator] Worker connected for session ${sessionId}`);
      socket.to(sessionId).emit("worker_connected", "");
    } else {
      logger.info(`[orchestrator] Browser connected for session ${sessionId}`);
      // If a worker is already in the room, let the browser know
      const room = io.sockets.adapter.rooms.get(sessionId);
      const workerAlready =
        room &&
        [...room].some(
          (id) => io.sockets.sockets.get(id)?.data.role === "worker",
        );
      if (workerAlready) socket.emit("worker_connected", "");
    }

    // Relay every application event to the other party in the room
    socket.onAny((event, ...args) => {
      socket.to(sessionId).emit(event, ...args);
    });

    socket.on("disconnect", () => {
      const session = sessionStore.get(sessionId);
      if (role === "worker") {
        logger.debug(
          `[orchestrator] Worker disconnected for session ${sessionId}`,
        );
        io.to(sessionId).emit("worker_disconnected", "");

        if (!session || restartingApps.has(session.appId)) return;

        // Check if the browser is still in the room before trying to reconnect
        const room = io.sockets.adapter.rooms.get(sessionId);
        const browserPresent =
          room &&
          [...room].some(
            (id) => io.sockets.sockets.get(id)?.data.role === "browser",
          );
        if (!browserPresent) return;

        // Re-inspect ports after restart (Docker may remap them) then wait for health
        inspectPorts(session.appId)
          .then(({ port4001 }) => {
            session.port4001 = port4001;
            return waitForWorker(session.appId, port4001, 60, 250);
          })
          .then(() => {
            const r = io.sockets.adapter.rooms.get(sessionId);
            const stillHasBrowser =
              r &&
              [...r].some(
                (id) => io.sockets.sockets.get(id)?.data.role === "browser",
              );
            if (!stillHasBrowser) return;
            fetch(`${workerUrl(session.appId, session.port4001)}/connect`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...workerAuthHeaders(),
              },
              body: JSON.stringify({ sessionId }),
            }).catch((err) =>
              logger.warn(
                `[orchestrator] Auto-reconnect failed for session ${sessionId}:`,
                err,
              ),
            );
          })
          .catch(() =>
            logger.warn(
              `[orchestrator] Worker did not recover for session ${sessionId}`,
            ),
          );
      } else {
        logger.debug(
          `[orchestrator] Browser disconnected for session ${sessionId}`,
        );
        // Cancel any active agent run on the worker side
        io.to(sessionId).emit("cancel");
      }
    });
  });
}

export function createSessionsRouter() {
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

    fetch(`${workerUrl(record.id, port4001)}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workerAuthHeaders() },
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

  router.post("/close", (c) => c.json({ closed: true }));

  return router;
}

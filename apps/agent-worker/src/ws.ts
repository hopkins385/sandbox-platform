import { io } from "socket.io-client";
import { logger } from "@sandbox/logger";
import type { SendMessageResponse } from "@sandbox/types";
import { WORKER_SECRET, ORCHESTRATOR_URL } from "./config.js";
import { pendingAnswers } from "./answers.js";
import { runAgent } from "./agent.js";

export function connectToOrchestrator(sessionId: string): void {
  const socket = io(ORCHESTRATOR_URL, {
    transports: ["websocket"],
    auth: { role: "worker", sessionId, token: WORKER_SECRET },
    reconnectionAttempts: 8,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
  });

  let activeAbort: AbortController | null = null;

  const emit = (msg: SendMessageResponse) => {
    if (socket.connected) socket.emit(msg.type, msg.content);
  };

  socket.on("connect", () => {
    logger.info(`[agent-worker] Connected to orchestrator for session ${sessionId}`);
  });

  socket.on("send", (message: string) => {
    runAgent(sessionId, message, "/app", emit)
      .then((abort) => { activeAbort = abort; })
      .catch((err) =>
        logger.error(`[agent-worker] Agent run error for session ${sessionId}:`, err),
      );
  });

  socket.on("cancel", () => {
    activeAbort?.abort();
    activeAbort = null;
  });

  socket.on("answer", (answers: Record<string, string>) => {
    pendingAnswers.get(sessionId)?.(answers);
  });

  socket.on("disconnect", (reason) => {
    logger.info(`[agent-worker] Disconnected from orchestrator for session ${sessionId}: ${reason}`);
    activeAbort?.abort();
    activeAbort = null;
    pendingAnswers.delete(sessionId);
  });

  socket.on("connect_error", (err) => {
    logger.warn(`[agent-worker] Connection error for session ${sessionId}: ${err.message}`);
  });
}

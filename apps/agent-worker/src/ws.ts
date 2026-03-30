import { io } from "socket.io-client";
import { logger } from "@sandbox/logger";
import { WORKER_SECRET, ORCHESTRATOR_URL } from "./config.js";
import { runAgent } from "./agent.js";
import { AgentRunOptions } from "@sandbox/types";

export function connectToOrchestrator(sessionId: string): void {
  const socket = io(ORCHESTRATOR_URL, {
    transports: ["websocket"],
    auth: { role: "worker", sessionId, token: WORKER_SECRET },
    reconnectionAttempts: 8,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
  });

  let activeAbort: AbortController | null = null;

  socket.on("connect", () => {
    logger.info(
      `[agent-worker] Connected to orchestrator for session ${sessionId}`,
    );
  });

  const handleSendMessage = async (
    message: string,
    abortController: AbortController,
  ) => {
    const options: AgentRunOptions = {
      prompt: message,
      cwd: "/app",
      maxTurns: 5,
      abortController,
    };

    try {
      for await (const msgResponse of runAgent(options)) {
        // TODO: handle disconnects in the middle of a run more gracefully (e.g. by buffering messages and sending them when reconnecting, or by implementing some kind of heartbeat to detect disconnects more quickly)
        socket.emit(msgResponse.type, msgResponse.content);
      }
    } catch (err) {
      logger.error(
        `[agent-worker] Agent run error for session ${sessionId}:`,
        err,
      );
    } finally {
      activeAbort = null;
    }
  };

  socket.on("send", (message: string) => {
    const abortController = new AbortController();
    activeAbort = abortController;
    handleSendMessage(message, abortController);
  });

  socket.on("cancel", () => {
    activeAbort?.abort();
    activeAbort = null;
  });

  socket.on("disconnect", (reason) => {
    logger.info(
      `[agent-worker] Disconnected from orchestrator for session ${sessionId}: ${reason}`,
    );
    activeAbort?.abort();
    activeAbort = null;
  });

  socket.on("connect_error", (err) => {
    logger.warn(
      `[agent-worker] Connection error for session ${sessionId}: ${err.message}`,
    );
  });
}

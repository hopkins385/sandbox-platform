import { logger } from "@sandbox/logger";
import type { SendMessageResponse, WsClientMessage } from "@sandbox/types";
import { WORKER_SECRET, ORCHESTRATOR_URL } from "./config.js";
import { pendingAnswers } from "./answers.js";
import { runAgent } from "./agent.js";

const MAX_RETRIES = 8;
const BASE_DELAY_MS = 500;

// Opens a single WebSocket attempt. Resolves true if the connection was opened
// and subsequently closed (normal lifecycle), false if it could not connect.
function attemptWsConnection(sessionId: string, wsUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    logger.info(`[agent-worker] Connecting to orchestrator WS: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    let opened = false;
    let activeAbort: AbortController | null = null;

    const emit = (msg: SendMessageResponse) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.addEventListener("open", () => {
      opened = true;
      logger.info(`[agent-worker] WS connected to orchestrator for session ${sessionId}`);
      ws.send(JSON.stringify({ type: "auth", token: WORKER_SECRET }));
    });

    ws.addEventListener("message", (event) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(event.data as string) as WsClientMessage;
      } catch {
        return;
      }

      if (msg.type === "send") {
        runAgent(sessionId, msg.message, "/app", emit)
          .then((abort) => { activeAbort = abort; })
          .catch((err) =>
            logger.error(`[agent-worker] Agent run error for session ${sessionId}:`, err),
          );
      } else if (msg.type === "cancel") {
        activeAbort?.abort();
        activeAbort = null;
      } else if (msg.type === "answer") {
        pendingAnswers.get(sessionId)?.(msg.answers);
      } else if (msg.type === "ping") {
        emit({ type: "pong", content: "" });
      }
    });

    ws.addEventListener("close", (event) => {
      logger.info(`[agent-worker] WS closed for session ${sessionId} — code=${event.code}`);
      activeAbort?.abort();
      activeAbort = null;
      pendingAnswers.delete(sessionId);
      resolve(opened);
    });

    ws.addEventListener("error", (event) => {
      logger.error(`[agent-worker] WS error for session ${sessionId}:`, event);
      // close event always fires after error, resolve() is called there
    });
  });
}

// Connects to the orchestrator WebSocket with exponential-backoff retries.
export async function connectToOrchestrator(sessionId: string): Promise<void> {
  const wsUrl = ORCHESTRATOR_URL.replace(/^http/, "ws") + `/api/sessions/ws/${sessionId}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const connected = await attemptWsConnection(sessionId, wsUrl);
    if (connected) return;

    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `[agent-worker] WS connect failed for session ${sessionId} (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error(
    `[agent-worker] Giving up WS connection for session ${sessionId} after ${MAX_RETRIES} attempts`,
  );
}

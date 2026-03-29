#!/usr/bin/env node
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "@sandbox/logger";
import type { SendMessageResponse, WsClientMessage } from "@sandbox/types";

logger.info(`[agent-worker] Starting agent worker...`);

// Credential guard: the recommended pattern is to proxy all Claude API requests
// through an external proxy (ANTHROPIC_BASE_URL) that injects the key, so the
// sandbox container never holds the real credential.
if (process.env.ANTHROPIC_API_KEY) {
  logger.warn(
    "[agent-worker] WARNING: ANTHROPIC_API_KEY is set inside the sandbox container. " +
      "Prefer the proxy pattern: run a credential-injecting proxy outside the container " +
      "and point ANTHROPIC_BASE_URL at it so the key never enters the agent boundary.",
  );
}

const WORKER_SECRET = process.env.WORKER_SECRET;
if (!WORKER_SECRET && process.env.NODE_ENV === "production") {
  logger.error(
    "[agent-worker] FATAL: WORKER_SECRET must be set in production. Exiting.",
  );
  process.exit(1);
}
if (!WORKER_SECRET) {
  logger.warn(
    "[agent-worker] WARNING: WORKER_SECRET is not set — " +
      "/connect is unauthenticated. " +
      "Set WORKER_SECRET to a strong random value in production.",
  );
}

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://orchestrator:4000";

const app = new Hono();

// Authenticate all mutating endpoints with a shared secret injected by the
// orchestrator at container-spawn time. /health is exempt so Docker/k8s probes
// don't need credentials.
app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${WORKER_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// Per-session pending answer resolvers keyed by sessionId
const pendingAnswers = new Map<
  string,
  (answers: Record<string, string>) => void
>();

const ANSWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function waitForAnswer(sessionId: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAnswers.delete(sessionId);
      reject(new Error(`Answer timeout for session ${sessionId}`));
    }, ANSWER_TIMEOUT_MS);
    pendingAnswers.set(sessionId, (answers) => {
      clearTimeout(timer);
      resolve(answers);
    });
  });
}

// GET /health
app.get("/health", (c) => c.json({ ok: true }));

// POST /connect  { sessionId }
// Connects this worker to the orchestrator WebSocket channel for the given session.
// Fire-and-forget: returns 204 immediately and connects in the background.
app.post("/connect", async (c) => {
  const { sessionId } = await c.req.json<{ sessionId: string }>();
  if (!sessionId || typeof sessionId !== "string") {
    return c.text("Invalid sessionId", 400);
  }
  connectToOrchestrator(sessionId).catch((err) =>
    logger.error(
      `[agent-worker] Unexpected WS error for session ${sessionId}:`,
      err,
    ),
  );
  return c.body(null, 204);
});

// Connects to the orchestrator WebSocket for the given session, authenticates,
// then handles inbound WsClientMessages and emits SendMessageResponse frames.
async function connectToOrchestrator(sessionId: string): Promise<void> {
  const wsUrl =
    ORCHESTRATOR_URL.replace(/^http/, "ws") + `/api/sessions/ws/${sessionId}`;

  const MAX_RETRIES = 8;
  const BASE_DELAY_MS = 500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const connected = await attemptWsConnection(sessionId, wsUrl);
    if (connected) return;

    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1); // 500ms, 1s, 2s, 4s …
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

// Opens a single WebSocket attempt. Resolves true if the connection was opened
// and subsequently closed (normal lifecycle), false if the connection could not
// be established at all (error before open).
function attemptWsConnection(
  sessionId: string,
  wsUrl: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    logger.info(`[agent-worker] Connecting to orchestrator WS: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    let opened = false;

    // One active AbortController per session for the running agent query
    let activeAbort: AbortController | null = null;

    const emit = (msg: SendMessageResponse) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.addEventListener("open", () => {
      opened = true;
      logger.info(
        `[agent-worker] WS connected to orchestrator for session ${sessionId}`,
      );
      // Authenticate as the worker — first message on the channel
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
        // Restrict cwd to the app directory to prevent path traversal.
        const cwd = "/app";
        runAgent(sessionId, msg.message, cwd, emit, () => activeAbort)
          .then((abort) => {
            activeAbort = abort;
          })
          .catch((err) =>
            logger.error(
              `[agent-worker] Agent run error for session ${sessionId}:`,
              err,
            ),
          );
      } else if (msg.type === "cancel") {
        activeAbort?.abort();
        activeAbort = null;
      } else if (msg.type === "answer") {
        const resolve = pendingAnswers.get(sessionId);
        if (resolve) resolve(msg.answers);
      } else if (msg.type === "ping") {
        emit({ type: "pong", content: "" });
      }
    });

    ws.addEventListener("close", (event) => {
      logger.info(
        `[agent-worker] WS closed for session ${sessionId} — code=${event.code}`,
      );
      activeAbort?.abort();
      activeAbort = null;
      pendingAnswers.delete(sessionId);
      resolve(opened); // true = normal close; false = never opened → retry
    });

    ws.addEventListener("error", (event) => {
      logger.error(`[agent-worker] WS error for session ${sessionId}:`, event);
      // close event always fires after error, so resolve() is called there
    });
  });
}

// Runs the agent query for a single message. Returns the AbortController so the
// caller can cancel it later. The caller must await the returned promise before
// storing the controller (it resolves with the controller immediately after
// launching the async work).
async function runAgent(
  sessionId: string,
  prompt: string,
  cwd: string,
  emit: (msg: SendMessageResponse) => void,
  getActiveAbort: () => AbortController | null,
): Promise<AbortController> {
  const abort = new AbortController();

  // Launch detached so runAgent resolves with the controller right away
  (async () => {
    const canUseToolMiddleware = async (
      toolName: string,
      input: Record<string, unknown>,
    ) => {
      if (toolName === "AskUserQuestion") {
        emit({
          type: "question",
          content: JSON.stringify(input["questions"]),
        });
        // Block until the browser sends an "answer" message (or timeout)
        const answers = await waitForAnswer(sessionId);
        return {
          behavior: "allow" as const,
          updatedInput: { questions: input["questions"], answers },
        };
      }
      return { behavior: "allow" as const, updatedInput: input };
    };

    try {
      const agentQuery = query({
        prompt,
        options: {
          cwd,
          maxTurns: 5,
          model: "claude-sonnet-4-6",
          settingSources: ["user", "project"],
          permissionMode: "acceptEdits",
          includePartialMessages: true,
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
          },
          mcpServers: {
            playwright: {
              command: "npx",
              args: ["-y", "@playwright/mcp@latest", "--headless"],
            },
          },
          allowedTools: [
            "Skill",
            "Read",
            "Edit",
            "Write",
            "Bash",
            "Glob",
            "GrepTool",
            "mcp__playwright__*",
            "AskUserQuestion",
          ],
          toolConfig: {
            askUserQuestion: { previewFormat: "markdown" },
          },
          canUseTool: canUseToolMiddleware,
        },
      });

      for await (const sdkMessage of agentQuery) {
        if (abort.signal.aborted) break;
        const { type, session_id, uuid } = sdkMessage;
        logger.info(
          `[agent-worker] SDK message: type=${type} session_id=${session_id} uuid=${uuid}`,
        );
        switch (type) {
          case "stream_event": {
            const event = sdkMessage.event;
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                emit({ type: "text_delta", content: event.delta.text });
              }
            }
            break;
          }
          case "assistant": {
            const textBlock = sdkMessage.message.content.find(
              (b: { type: string }) => b.type === "text",
            );
            if (textBlock && textBlock.type === "text") {
              emit({ type: "text", content: textBlock.text });
            }
            break;
          }
          case "user": {
            for (const block of sdkMessage.message.content as Array<{
              type: string;
              content?: Array<{
                type: string;
                source?: { type: string; data: string; media_type: string };
              }>;
            }>) {
              if (block.type !== "tool_result" || !Array.isArray(block.content))
                continue;
              for (const inner of block.content) {
                if (inner.type === "image" && inner.source?.type === "base64") {
                  emit({
                    type: "screenshot",
                    content: `data:${inner.source.media_type};base64,${inner.source.data}`,
                  });
                }
              }
            }
            break;
          }
          case "result": {
            if (sdkMessage.subtype !== "success") {
              if (sdkMessage.is_error) {
                emit({
                  type: "error",
                  content: `Run failed: ${sdkMessage.errors.map((err) => err).join("; ")}`,
                });
              } else {
                emit({
                  type: "status",
                  content: `Run ended with status: ${sdkMessage.subtype}`,
                });
              }
              break;
            }
            const totalCost = `Total cost: $${sdkMessage.total_cost_usd}`;
            emit({
              type: "result",
              content: JSON.stringify({
                sessionId: session_id,
                messageId: uuid,
                totalCost,
              }),
            });
            break;
          }
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const error = err instanceof Error ? err.message : String(err);
        emit({ type: "error", content: error });
      }
    } finally {
      emit({ type: "done", content: "" });
    }
  })().catch((err) =>
    logger.error(
      `[agent-worker] Unhandled agent error for session ${sessionId}:`,
      err,
    ),
  );

  return abort;
}

const PORT = 4001;
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info(`[agent-worker] listening on :${PORT}`);
});

server.on("error", (err) => {
  logger.error("[agent-worker] Server error:", err);
  process.exit(1);
});

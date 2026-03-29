#!/usr/bin/env node
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "@sandbox/logger";
import type { SendMessageResponse } from "@sandbox/types";

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
      "/run, /answer, and /cancel are unauthenticated. " +
      "Set WORKER_SECRET to a strong random value in production.",
  );
}

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

// Per-run pending answer resolvers keyed by runId
const pendingAnswers = new Map<
  string,
  (answers: Record<string, string>) => void
>();

const ANSWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function waitForAnswer(runId: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAnswers.delete(runId);
      reject(new Error(`Answer timeout for run ${runId}`));
    }, ANSWER_TIMEOUT_MS);
    pendingAnswers.set(runId, (answers) => {
      clearTimeout(timer);
      resolve(answers);
    });
  });
}

// GET /health
app.get("/health", (c) => c.json({ ok: true }));

// POST /run  { prompt, cwd, runId }
// Streams SendMessageResponse events as SSE
app.post("/run", async (c) => {
  const {
    prompt,
    cwd = "/app",
    runId,
  } = await c.req.json<{
    prompt: string;
    cwd?: string;
    runId: string;
  }>();

  logger.info(
    `[agent-worker] Received /run request: runId=${runId} cwd=${cwd}`,
  );

  // Validate inputs at the boundary before they reach the agent or filesystem.
  if (!/^[\w-]{1,128}$/.test(runId)) {
    return c.text("Invalid runId", 400);
  }
  // Restrict cwd to the app directory to prevent path traversal.
  if (!cwd.startsWith("/app")) {
    return c.text("Invalid cwd: must be within /app", 400);
  }

  return streamSSE(c, async (stream) => {
    const emit = async (msg: SendMessageResponse) => {
      await stream.writeSSE({ data: JSON.stringify(msg) });
    };

    const canUseToolMiddleware = async (
      toolName: string,
      input: Record<string, unknown>,
    ) => {
      if (toolName === "AskUserQuestion") {
        await emit({
          type: "question",
          content: JSON.stringify(input["questions"]),
        });
        // Block until /answer is called for this runId (or timeout)
        const answers = await waitForAnswer(runId);
        return {
          behavior: "allow" as const,
          updatedInput: { questions: input["questions"], answers },
        };
      }
      return { behavior: "allow" as const, updatedInput: input };
    };

    let aborted = false;

    // Allow the orchestrator to cancel this run
    stream.onAbort(() => {
      aborted = true;
    });

    try {
      const agentQuery = query({
        prompt,
        options: {
          cwd,
          maxTurns: 5,
          model: "claude-sonnet-4-6",
          settingSources: ["user", "project"],
          permissionMode: "acceptEdits",
          includePartialMessages: true, // Stream partial messages for more responsive UI updates
          systemPrompt: {
            type: "preset",
            preset: "claude_code", // Use Claude Code's system prompt
            // append: "",
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
        if (aborted) break;
        const { type, session_id, uuid } = sdkMessage;
        logger.info(
          `[agent-worker] SDK message: type=${type} session_id=${session_id} uuid=${uuid}`,
        );
        switch (type) {
          case "stream_event": {
            const event = sdkMessage.event;
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                await emit({ type: "text_delta", content: event.delta.text });
              }
            }
            break;
          }
          case "assistant": {
            const textBlock = sdkMessage.message.content.find(
              (b: { type: string }) => b.type === "text",
            );
            if (textBlock && textBlock.type === "text") {
              await emit({ type: "text", content: textBlock.text });
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
                  await emit({
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
                await emit({
                  type: "error",
                  content: `Run failed: ${sdkMessage.errors.map((err) => err).join("; ")}`,
                });
              } else {
                await emit({
                  type: "status",
                  content: `Run ended with status: ${sdkMessage.subtype}`,
                });
              }
              break;
            }
            const totalCost = `Total cost: $${sdkMessage.total_cost_usd}`;
            await emit({
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
      const error = err instanceof Error ? err.message : String(err);
      await emit({ type: "error", content: error });
    } finally {
      await emit({ type: "done", content: "" });
    }
  });
});

// POST /answer  { runId, answers }
// Unblocks a canUseTool callback waiting for an AskUserQuestion response
app.post("/answer", async (c) => {
  const { runId, answers } = await c.req.json<{
    runId: string;
    answers: Record<string, string>;
  }>();
  const resolve = pendingAnswers.get(runId);
  if (!resolve) {
    return c.json({ delivered: false }, 404);
  }
  resolve(answers);
  return c.json({ delivered: true });
});

// POST /cancel  { runId }
// Aborts an active SSE stream by closing the connection
const activeControllers = new Map<string, AbortController>();

app.post("/cancel", async (c) => {
  const { runId } = await c.req.json<{ runId: string }>();
  activeControllers.get(runId)?.abort();
  return c.json({ cancelled: true });
});

const PORT = 4001;
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info(`[agent-worker] listening on :${PORT}`);
});

server.on("error", (err) => {
  logger.error("[agent-worker] Server error:", err);
  process.exit(1);
});

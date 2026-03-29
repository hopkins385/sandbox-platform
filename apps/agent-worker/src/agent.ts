import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "@sandbox/logger";
import type { SendMessageResponse } from "@sandbox/types";
import { waitForAnswer } from "./answers.js";

async function canUseToolMiddleware(
  sessionId: string,
  emit: (msg: SendMessageResponse) => void,
  toolName: string,
  input: Record<string, unknown>,
) {
  if (toolName === "AskUserQuestion") {
    emit({ type: "question", content: JSON.stringify(input["questions"]) });
    const answers = await waitForAnswer(sessionId);
    return {
      behavior: "allow" as const,
      updatedInput: { questions: input["questions"], answers },
    };
  }
  return { behavior: "allow" as const, updatedInput: input };
}

function handleSdkMessage(
  sdkMessage: Record<string, unknown>,
  emit: (msg: SendMessageResponse) => void,
) {
  const { type, session_id, uuid } = sdkMessage as {
    type: string;
    session_id: string;
    uuid: string;
    [key: string]: unknown;
  };

  logger.info(
    `[agent-worker] SDK message: type=${type} session_id=${session_id} uuid=${uuid}`,
  );

  switch (type) {
    case "stream_event": {
      const event = (
        sdkMessage as {
          event: { type: string; delta: { type: string; text: string } };
        }
      ).event;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        emit({ type: "text_delta", content: event.delta.text });
      }
      break;
    }
    case "assistant": {
      const textBlock = (
        sdkMessage as {
          message: { content: Array<{ type: string; text?: string }> };
        }
      ).message.content.find((b) => b.type === "text");
      if (textBlock?.type === "text" && textBlock.text) {
        emit({ type: "text", content: textBlock.text });
      }
      break;
    }
    case "user": {
      const blocks = (
        sdkMessage as {
          message: {
            content: Array<{
              type: string;
              content?: Array<{
                type: string;
                source?: { type: string; data: string; media_type: string };
              }>;
            }>;
          };
        }
      ).message.content;

      for (const block of blocks) {
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
      const result = sdkMessage as {
        subtype: string;
        is_error?: boolean;
        errors?: unknown[];
        total_cost_usd?: number;
      };
      if (result.subtype !== "success") {
        if (result.is_error) {
          emit({
            type: "error",
            content: `Run failed: ${(result.errors ?? []).map((e) => e).join("; ")}`,
          });
        } else {
          emit({
            type: "status",
            content: `Run ended with status: ${result.subtype}`,
          });
        }
        break;
      }
      emit({
        type: "result",
        content: JSON.stringify({
          sessionId: session_id,
          messageId: uuid,
          totalCost: `Total cost: $${result.total_cost_usd}`,
        }),
      });
      break;
    }
    default: {
      logger.warn(
        `[agent-worker] Unknown SDK message type: ${type}, message:`,
        sdkMessage,
      );
    }
  }
}

// Runs the agent query for a single message. Returns the AbortController so the
// caller can cancel it later. Resolves with the controller immediately after
// launching the async work.
export async function runAgent(
  sessionId: string,
  prompt: string,
  cwd: string,
  emit: (msg: SendMessageResponse) => void,
): Promise<AbortController> {
  const abort = new AbortController();

  (async () => {
    try {
      const agentQuery = query({
        prompt,
        options: {
          cwd,
          maxTurns: 5,
          model: "claude-sonnet-4-6",
          settingSources: ["user", "project"],
          permissionMode: "acceptEdits",
          includePartialMessages: false,
          systemPrompt: { type: "preset", preset: "claude_code" },
          allowedTools: [
            "Skill",
            "Read",
            "Edit",
            "Write",
            "Bash",
            "Glob",
            "GrepTool",
            "AskUserQuestion",
          ],
          toolConfig: { askUserQuestion: { previewFormat: "markdown" } },
          canUseTool: (toolName, input) =>
            canUseToolMiddleware(sessionId, emit, toolName, input),
        },
      });

      for await (const sdkMessage of agentQuery) {
        if (abort.signal.aborted) break;
        handleSdkMessage(sdkMessage as Record<string, unknown>, emit);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        emit({
          type: "error",
          content: err instanceof Error ? err.message : String(err),
        });
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

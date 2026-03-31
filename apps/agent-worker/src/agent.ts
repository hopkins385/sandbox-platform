import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "@sandbox/logger";
import type { AgentRunOptions, SendMessageResponse } from "@sandbox/types";

export async function* runAgent(
  options: AgentRunOptions,
): AsyncGenerator<SendMessageResponse> {
  const { prompt, cwd, abortController, maxTurns = 5 } = options;

  const agentQueryWithQuestion = query({
    prompt,
    options: {
      abortController,
      cwd,
      maxTurns,
      model: "claude-sonnet-4-6",
      settingSources: ["user", "project"],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
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
        "TodoWrite",
        "WebFetch",
      ],
    },
  });

  try {
    for await (const sdkMessage of agentQueryWithQuestion) {
      if (abortController.signal.aborted) break;
      yield* mapSdkMessage(sdkMessage);
    }
  } finally {
    yield { type: "done", content: "" };
  }
}

function* mapSdkMessage(
  sdkMessage: SDKMessage,
): Generator<SendMessageResponse> {
  const { type, session_id, uuid } = sdkMessage;

  logger.info(
    `[agent-worker] SDK message: type=${type} session_id=${session_id} uuid=${uuid}`,
  );

  switch (type) {
    //
    case "stream_event": {
      const event = sdkMessage.event;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text_delta", content: event.delta.text };
      }
      break;
    }
    //
    case "assistant": {
      const textBlock = sdkMessage.message.content.find(
        (b) => b.type === "text",
      );
      if (textBlock?.type === "text" && textBlock.text) {
        yield { type: "text", content: textBlock.text };
      }
      break;
    }
    //
    case "user": {
      logger.info(
        `[agent-worker] Received user message in SDK output:`,
        sdkMessage,
      );
      break;
    }
    //
    case "result": {
      const result = sdkMessage;
      if (result.subtype !== "success") {
        if (result.is_error) {
          yield {
            type: "error",
            content: `Run failed: ${(result.errors ?? []).map((e) => e).join("; ")}`,
          };
        } else {
          yield {
            type: "status",
            content: `Run ended with status: ${result.subtype}`,
          };
        }
        break;
      }
      yield {
        type: "result",
        content: JSON.stringify({
          sessionId: session_id,
          messageId: uuid,
          totalCost: `Total cost: $${result.total_cost_usd}`,
        }),
      };
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

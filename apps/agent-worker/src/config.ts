import { logger } from "@sandbox/logger";

if (process.env.ANTHROPIC_API_KEY) {
  logger.warn(
    "[agent-worker] WARNING: ANTHROPIC_API_KEY is set inside the sandbox container. " +
      "Prefer the proxy pattern: run a credential-injecting proxy outside the container " +
      "and point ANTHROPIC_BASE_URL at it so the key never enters the agent boundary.",
  );
}

export const WORKER_SECRET = process.env.WORKER_SECRET;

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

export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://orchestrator:4000";

export const PORT = 4001;

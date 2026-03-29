const WORKER_SECRET = process.env.WORKER_SECRET;
if (!WORKER_SECRET) {
  console.warn(
    "[orchestrator] WARNING: WORKER_SECRET is not set — worker endpoints will be unauthenticated.",
  );
}

// When running inside Docker the orchestrator cannot reach sandbox containers
// via `localhost:<hostPort>` (that address resolves to the orchestrator
// container itself).  Use the container's Docker-network hostname and its
// internal port instead.  In local dev the orchestrator runs directly on the
// host, where `localhost:<hostPort>` is fine.
const USE_DOCKER_NETWORK = process.env.NODE_ENV === "production";
const SANDBOX_CONTAINER_PREFIX = "sandbox-app-";
const WORKER_INTERNAL_PORT = 4001;

export function workerAuthHeaders(): Record<string, string> {
  return WORKER_SECRET ? { Authorization: `Bearer ${WORKER_SECRET}` } : {};
}

export function workerUrl(appId: string, hostPort: number): string {
  if (USE_DOCKER_NETWORK) {
    return `http://${SANDBOX_CONTAINER_PREFIX}${appId}:${WORKER_INTERNAL_PORT}`;
  }
  return `http://localhost:${hostPort}`;
}

export async function waitForWorker(
  appId: string,
  hostPort: number,
  retries = 20,
  delayMs = 500,
): Promise<void> {
  const url = `${workerUrl(appId, hostPort)}/health`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Worker on port ${hostPort} did not become healthy in time`);
}

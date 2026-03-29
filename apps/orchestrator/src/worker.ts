const WORKER_SECRET = process.env.WORKER_SECRET;
if (!WORKER_SECRET) {
  console.warn(
    "[orchestrator] WARNING: WORKER_SECRET is not set — worker endpoints will be unauthenticated.",
  );
}

export function workerAuthHeaders(): Record<string, string> {
  return WORKER_SECRET ? { Authorization: `Bearer ${WORKER_SECRET}` } : {};
}

export function workerUrl(port: number): string {
  return `http://localhost:${port}`;
}

export async function waitForWorker(
  port: number,
  retries = 20,
  delayMs = 500,
): Promise<void> {
  const url = `${workerUrl(port)}/health`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Worker on port ${port} did not become healthy in time`);
}

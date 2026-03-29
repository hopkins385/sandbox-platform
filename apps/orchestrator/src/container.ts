import Dockerode from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { apps } from "./db/schema.js";
import { waitForWorker } from "./worker.js";

export const docker = new Dockerode();

export const SANDBOX_IMAGE = "sandbox-platform-sandbox:latest";
export const SANDBOX_NETWORK = "sandbox-net";
const CONTAINER_PREFIX = "sandbox-app-";

export function containerName(appId: string) {
  return `${CONTAINER_PREFIX}${appId}`;
}

export async function ensureNetwork(): Promise<void> {
  const networks = await docker.listNetworks({
    filters: { name: [SANDBOX_NETWORK] },
  });
  if (!networks.some((n) => n.Name === SANDBOX_NETWORK)) {
    await docker.createNetwork({ Name: SANDBOX_NETWORK, Driver: "bridge" });
    console.log(`[orchestrator] Created Docker network: ${SANDBOX_NETWORK}`);
  }
}

export async function inspectPorts(
  appId: string,
): Promise<{ port3000: number; port4001: number }> {
  const info = await docker.getContainer(containerName(appId)).inspect();
  const b = info.NetworkSettings.Ports;
  const port3000 = parseInt(b["3000/tcp"]?.[0]?.HostPort ?? "0", 10);
  const port4001 = parseInt(b["4001/tcp"]?.[0]?.HostPort ?? "0", 10);
  if (!port3000 || !port4001)
    throw new Error(`Container for app ${appId} has no port bindings`);
  return { port3000, port4001 };
}

/** Creates, starts, and waits for the sandbox container. Updates DB on completion. */
export async function spawnContainer(appId: string): Promise<void> {
  await ensureNetwork();

  const container = await docker.createContainer({
    name: containerName(appId),
    Image: SANDBOX_IMAGE,
    ExposedPorts: { "3000/tcp": {}, "4001/tcp": {} },
    HostConfig: {
      PortBindings: {
        "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "" }],
        "4001/tcp": [{ HostIp: "0.0.0.0", HostPort: "" }],
      },
      NetworkMode: SANDBOX_NETWORK,
      RestartPolicy: { Name: "unless-stopped" },
    },
    Env: [
      `WORKER_SECRET=${process.env.WORKER_SECRET ?? ""}`,
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
      `ORCHESTRATOR_URL=${process.env.ORCHESTRATOR_URL ?? "http://orchestrator:4000"}`,
    ],
  });

  await container.start();

  const { port4001 } = await inspectPorts(appId);
  await waitForWorker(appId, port4001);

  await db
    .update(apps)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(apps.id, appId));

  console.log(`[orchestrator] App ${appId} (${containerName(appId)}) ready`);
}

/** Stops and removes the container. Swallows errors if already gone. */
export async function destroyContainer(appId: string): Promise<void> {
  const container = docker.getContainer(containerName(appId));
  await container.stop({ t: 5 }).catch(() => {});
  await container.remove().catch(() => {});
}

/** On startup: reconcile DB app statuses against actual container states. */
export async function reconcileApps(): Promise<void> {
  const rows = await db.select().from(apps);
  for (const row of rows) {
    try {
      const info = await docker.getContainer(containerName(row.id)).inspect();
      const status = info.State.Running ? "running" : "stopped";
      await db
        .update(apps)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(apps.id, row.id));
    } catch {
      if (row.status === "running" || row.status === "creating") {
        await db
          .update(apps)
          .set({ status: "error", updatedAt: new Date().toISOString() })
          .where(eq(apps.id, row.id));
      }
    }
  }
  console.log(`[orchestrator] Reconciled ${rows.length} app(s)`);
}

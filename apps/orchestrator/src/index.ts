import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type {
  App,
  AppListResponse,
  SessionOpenRequest,
  SessionOpenResponse,
  SendMessageRequest,
  SendMessageResponse,
  CancelMessageRequest,
  CancelMessageResponse,
  AnswerMessageRequest,
  AnswerMessageResponse,
} from "@sandbox/types";

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:3001" }));

// Auth stub — reads x-user-id header (later SSO)
app.use("*", async (c, next) => {
  const userId = c.req.header("x-user-id");
  if (userId) c.set("userId" as never, userId);
  await next();
});

// Mock data
const mockApps: App[] = [
  {
    id: "1",
    slug: "crm-tool",
    name: "CRM Tool",
    ownerId: "anna",
    status: "running",
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-03-20T14:30:00Z",
  },
  {
    id: "2",
    slug: "rechnungen",
    name: "Rechnungen",
    ownerId: "anna",
    status: "stopped",
    createdAt: "2026-02-01T09:00:00Z",
    updatedAt: "2026-03-18T11:00:00Z",
  },
  {
    id: "3",
    slug: "urlaubsplaner",
    name: "Urlaubsplaner",
    ownerId: "bob",
    status: "creating",
    createdAt: "2026-03-25T08:00:00Z",
    updatedAt: "2026-03-25T08:05:00Z",
  },
];

// Shared secret used to authenticate requests to the agent-worker inside each
// sandbox container. Must match the WORKER_SECRET env var set on the container.
const WORKER_SECRET = process.env.WORKER_SECRET;
if (!WORKER_SECRET) {
  console.warn(
    "[orchestrator] WARNING: WORKER_SECRET is not set — worker endpoints will be unauthenticated.",
  );
}

/** Returns headers that authenticate the orchestrator to a worker container. */
function workerAuthHeaders(): Record<string, string> {
  return WORKER_SECRET ? { Authorization: `Bearer ${WORKER_SECRET}` } : {};
}

// Base URL of the agent-worker HTTP server inside a sandbox container.
// TODO: resolve per-session container IP via dockerode
function workerUrl(containerIp: string) {
  return `http://${containerIp}:4001`;
}

/** Polls GET /health until the worker is ready or retries are exhausted. */
async function waitForWorker(
  containerIp: string,
  retries = 20,
  delayMs = 500,
): Promise<void> {
  const url = `${workerUrl(containerIp)}/health`;
  for (let i = 0; i < retries; i++) {
    try {
      // /health is unauthenticated; no auth header needed here
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Worker at ${containerIp} did not become healthy in time`);
}

app.get("/api/apps", (c) => {
  const response: AppListResponse = {
    owned: mockApps.slice(0, 2),
    collaborations: mockApps.slice(2),
  };
  return c.json(response);
});

app.post("/api/apps", (c) => {
  const newApp: App = {
    id: String(Date.now()),
    slug: "neue-app-" + Date.now(),
    name: "Neue App",
    ownerId: "anna",
    status: "creating",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return c.json(newApp, 201);
});

app.delete("/api/apps/:id", (c) => {
  return c.json({ deleted: true, id: c.req.param("id") });
});

app.post("/api/apps/:id/collaborators", async (c) => {
  const body = await c.req.json();
  return c.json({ added: true, appId: c.req.param("id"), ...body });
});

app.post("/api/sessions/open", async (c) => {
  const body = await c.req.json<SessionOpenRequest>();
  const found = mockApps.find((a) => a.id === body.appId) ?? mockApps[0];
  const response: SessionOpenResponse = {
    sessionId: "session-" + Date.now(),
    app: found,
    previewUrl: `https://${found.slug}.sandbox.firma.local`,
  };
  return c.json(response);
});

app.post("/api/sessions/send", async (c) => {
  void (await c.req.json<SendMessageRequest>());

  const events: SendMessageResponse[] = [
    { type: "status", content: "Analysiere Anfrage..." },
    {
      type: "text",
      content:
        "Ich habe eine neue Seite unter pages/kunden.vue erstellt und die Navigation entsprechend aktualisiert.",
    },
    { type: "done", content: "" },
  ];

  return streamSSE(c, async (stream) => {
    for (const event of events) {
      await stream.writeSSE({ data: JSON.stringify(event) });
      await stream.sleep(1000);
    }
  });
});

app.post("/api/sessions/close", (c) => {
  return c.json({ closed: true });
});

app.post("/api/sessions/cancel", async (c) => {
  const { sessionId } = await c.req.json<CancelMessageRequest>();

  // TODO: look up containerId from session store, then:
  // await fetch(`${workerUrl(containerIp)}/cancel`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
  //   body: JSON.stringify({ runId: sessionId }),
  // })

  const response: CancelMessageResponse = { cancelled: true };
  return c.json(response);
});

app.post("/api/sessions/answer", async (c) => {
  const { sessionId, answers } = await c.req.json<AnswerMessageRequest>();

  // TODO: look up containerIp from session store
  // const containerIp = sessionStore.get(sessionId).containerIp
  // const res = await fetch(`${workerUrl(containerIp)}/answer`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
  //   body: JSON.stringify({ runId: sessionId, answers }),
  // })
  // if (!res.ok) return c.json({ delivered: false } satisfies AnswerMessageResponse, 404)

  void workerUrl; // referenced above; remove once wired up
  return c.json({ delivered: true } satisfies AnswerMessageResponse);
});

const PORT = 4000;
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Orchestrator running on :${PORT}`);
});

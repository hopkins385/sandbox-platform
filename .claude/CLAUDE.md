# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (all services with hot-reload)
pnpm dev

# Build all packages
pnpm build

# Lint all packages
pnpm lint

# Type-check all packages
turbo typecheck

# Build the sandbox Docker image
pnpm build:sandbox

# Run a single app's dev/build/lint directly
pnpm --filter @sandbox/orchestrator dev
pnpm --filter @sandbox/web-studio dev
pnpm --filter @sandbox/agent-worker dev
```

Environment: copy `.env.example` to `.env` and fill in `WORKER_SECRET`, `ANTHROPIC_API_KEY`, and `ORCHESTRATOR_URL` before starting.

## Architecture

Three-tier real-time system:

```
Browser (web-studio :3001)
  ↕ REST + Socket.IO
Orchestrator (:4000)   ← Express/Socket.IO relay + SQLite (Drizzle/LibSQL)
  ↕ HTTP POST + Socket.IO
Agent Worker (:4001)   ← Hono HTTP + Socket.IO client, runs in Docker
  ↕ Anthropic SDK
Claude API
```

### Orchestrator (`apps/orchestrator`)

The central relay. Owns:
- **Docker lifecycle** via Dockerode (`src/container.ts`) — creates/destroys/recreates `sandbox-app-{appId}` containers on `sandbox-net`
- **SQLite app records** — single `apps` table tracking id, slug, name, status
- **In-memory session store** (`Map<sessionId, SessionRecord>`) — lost on restart
- **Socket.IO rooms** — routes `send`/`cancel`/`answer` from browser to worker, and `text_delta`/`screenshot`/`question`/`result` back

Session flow: `POST /api/sessions/open` → generates sessionId → calls `/connect` on worker (fire-and-forget) → both browser and worker join the same Socket.IO room.

### Agent Worker (`apps/agent-worker`)

Runs inside each sandbox container. Owns:
- **Claude SDK execution** (`src/agent.ts`) — streams agent events, maps them to `SendMessageResponse` types
- **Socket.IO client** (`src/ws.ts`) — connects back to orchestrator with `WORKER_SECRET`; supports session resumption for multi-turn conversations
- **Cancellation** — listens for `cancel` event mid-stream

### Web Studio (`apps/web-studio`)

Nuxt 4 SPA (SSR disabled). Key patterns:
- `pages/app/[slug].vue` — Socket.IO client, chat rendering, live preview iframe (port 3000 in container)
- `composables/useTokenSmoothening.ts` — word-by-word streaming effect (buffer flush timer — reset carefully to avoid leaks)
- Index page polls `/api/apps` every 10 seconds for status updates

### Shared Packages

- `packages/shared-types` — REST and WebSocket message interfaces shared across all apps
- `packages/logger` — Consola-based logger wrapper

## Key Design Constraints

**Session store is in-memory only.** Sessions are lost if the orchestrator restarts. There is no session persistence in the database.

**Worker auth uses `WORKER_SECRET`.** The orchestrator verifies this header on Socket.IO connection. The browser role is unauthenticated — `x-user-id` header is accepted but not enforced.

**Container networking:** In production, workers are reached via Docker DNS (`sandbox-app-{appId}:4001`). In dev, via localhost with dynamic port binding. The `WORKER_DEV=true` env var switches worker to `tsx watch` hot-reload mode.

**`restartingApps` set** in orchestrator tracks containers mid-recreation to block duplicate operations. It is cleared in `finally` blocks — be careful not to add additional clearing paths that create TOCTOU races.

**Socket.IO room model:** Both browser and worker clients join `room:{sessionId}`. The orchestrator relays events between them. Worker disconnect does not auto-clean the session from the store.

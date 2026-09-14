# Sandbox Platform

> [!WARNING]
> **Not production ready.** This is a proof of concept with known, unresolved security issues, including unauthenticated API access and API keys injected into sandbox containers. Do not deploy this outside a trusted, isolated network, and do not point it at production data. See `docs/ARCHITECTURE_REVIEW.md` for the full list of gaps.
>
> If you want to deploy and test this, put it in a trusted and secure network e.g. VPN so only trusted devices can reach the orchestrator at all. That closes the "wide open on the network" exposure, but it's not a substitute for fixing the auth and API-key issues above: anyone on the VPN can still act as anyone else, and a compromised sandbox container can still exfiltrate the API key unless container egress is also restricted.

A proof of concept that lets non-developers build small web apps with Claude Code, safely.

A user opens the web studio, describes what they want in plain language, and Claude Code edits a live Nuxt app inside an isolated sandbox container on their behalf. There's no local setup, no terminal, and no git for the user, just a chat interface and a preview of the running app. The primary use case is quick data-visualization apps and dashboards, but any small fullstack app is fair game.

Each app runs in its own Docker container, so one user's Claude session can't affect another app or the host. Once an app is running, its live preview is reachable by anyone else on the same corporate network, so results can be shared without a separate deploy step.

## How it works

1. A user creates an app in the web studio. The orchestrator spins up a fresh sandbox container (Docker) pre-loaded with a minimal Nuxt starter template.
2. Inside that container, an agent worker runs Claude Code against the app's source, driven by the chat messages the user sends from the browser.
3. Changes Claude makes are applied directly to the running Nuxt dev server in the container (hot-reload), so the user sees updates live.
4. The app's preview (port 3000 in the container) is exposed on the shared Docker network, so anyone else in the organization can open it directly, no separate publish/deploy step required.

## Why the sandboxing matters

Letting non-developers run an AI agent that writes and executes arbitrary code, and then auto-publishing the result to colleagues, is only acceptable if that code cannot reach anything beyond its own app. This isn't just good hygiene: in a corporate environment that falls under KRITIS (Germany's critical infrastructure regulation) or is otherwise expected to follow BSI IT-Grundschutz baseline controls, uncontained code execution and unreviewed auto-deployment would be a compliance problem, not just a security one.

That's why every app gets its own disposable Docker container instead of a shared runtime: a compromised or buggy container can't touch the host, the orchestrator, or other apps' containers. It's also why the known gaps in `docs/ARCHITECTURE_REVIEW.md` are called out explicitly rather than silently accepted. They mark this as a proof of concept, not something to point at production data or a network segment that matters, until those gaps are closed.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in WORKER_SECRET, ANTHROPIC_API_KEY, ORCHESTRATOR_URL
pnpm dev
```

## Structure

Three-tier real-time system: browser ↔ orchestrator ↔ per-app sandbox container ↔ Claude API.

- `apps/orchestrator` — Hono/Socket.IO backend (:4000). Manages Docker container lifecycle, the SQLite app registry, and relays chat/session events between browser and worker.
- `apps/agent-worker` — Runs inside each sandbox container (:4001). Executes Claude Code against the app's files and streams results back over Socket.IO.
- `apps/web-studio` — Nuxt frontend (:3001). Chat UI, live app preview, and app management.
- `packages/nuxt-starter` — The minimal Nuxt app template baked into every new sandbox; this is what Claude edits.
- `packages/shared-types` — Shared TypeScript interfaces for the REST/WebSocket protocol.
- `packages/logger` — Shared logger.
- `packages/tsconfig`, `packages/eslint-config` — Shared TS/ESLint configs.
- `docker/sandbox-image` — Dockerfile and init script for the per-app sandbox container.

## Status

This is a proof of concept, not production-hardened. Notably: sessions live in memory only (lost on orchestrator restart), and the browser side is unauthenticated.

## License

MIT © Sven Stadhouders. See [LICENSE](./LICENSE).

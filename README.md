# Sandbox Platform

Turborepo monorepo for the internal app platform.

## Setup

```bash
pnpm install
pnpm dev
```

## Structure

- `apps/orchestrator` — Express backend API (:4000)
- `apps/web-studio` — Nuxt 3 frontend (:3001)
- `packages/shared-types` — Shared TypeScript interfaces
- `packages/agent-worker` — Claude agent worker script
- `packages/tsconfig` — Shared TypeScript configs
- `packages/eslint-config` — Shared ESLint config
- `docker/` — Docker images and templates

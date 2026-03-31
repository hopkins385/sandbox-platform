# Architecture Review

## Overview

Modern, well-structured Turborepo monorepo for sandboxing Claude agent executions with a real-time collaborative UI. Clean separation between orchestrator (backend relay), web-studio (Nuxt frontend), and agent-worker (Claude SDK executor). Core architecture is sound — the main rough edges are incomplete features, missing session persistence, and a few race conditions.

---

## Security

### No HTTP API authentication
`x-user-id` is an unenforced request header. Any local process can CRUD apps and sessions without credentials. Intentional for internal/trusted-network use, but there are no guardrails if the orchestrator is ever exposed beyond localhost.

### ANTHROPIC_API_KEY inside sandbox containers
`config.ts` warns when the key is present but does not block it. A compromised or malicious app template could exfiltrate the key. Consider proxying Anthropic API calls through the orchestrator instead of injecting the raw key into each container.

### No input validation on chat messages
Agent prompts are passed directly to the Claude SDK without sanitization or length limits. Lower risk since it is your own agent, but worth noting if the platform ever becomes multi-tenant.

---

## Correctness / Race Conditions

### In-memory `sessionStore` lost on restart
Sessions are stored in a plain `Map` on the orchestrator process. Any crash or restart orphans all active WebSocket connections and breaks in-flight agent runs. Needs persistence (database row or Redis) to survive restarts.

### `restartingApps` Set — multiple clearing code paths
The Set that tracks containers mid-restart is cleared in a `finally` block but also touched by other code paths, creating a potential TOCTOU race during concurrent container restarts.

### `sessionStore` deletion races agent runs
Disconnect handlers delete the session entry while an agent run may still be writing events to that session's socket. The agent continues emitting into a void with no error surfaced.

---

## Incomplete Features

### `POST /api/sessions/close` does nothing
Returns `{ closed: true }` without closing the socket, removing the session, or stopping the worker. The endpoint is a stub.

### Collaborators API is a stub
`POST /api/apps/:id/collaborators` echoes the request body back without persisting anything to the database.

---

## Type Safety

### `c.set("userId" as never, userId)`
Hono's context typing is cast away with `as never` to force a property set. If the Hono context type changes this will silently break at runtime rather than compile time.

### `socket.data` typed as `never`
Socket metadata is typed as `never` and then cast back to `string` at every access point. The actual shape should be declared as a typed interface on the Socket.IO server generic.

### `mapSdkMessage` identity map
The error array in `agent.ts` is mapped with `.map((e) => e)` — a no-op that suggests the intended transformation (e.g. extracting a message field) was never implemented.

---

## Performance / Scalability

### `recreateAllContainers()` runs sequentially
Containers are recreated one at a time. Should use `Promise.allSettled` to parallelize and surface individual failures without blocking the rest.

### 3-second polling on the index page
`useIntervalFn` fires every 3 seconds to refresh app status. As the app list grows this will create unnecessary load. Consider switching to a WebSocket push model or increasing the interval with exponential backoff.

### `destroyContainer()` swallows all errors
Errors are caught and discarded silently, making it impossible to distinguish "container not found" from "permission denied" or Docker daemon errors.

---

## Minor Issues

### `useTokenSmoothening` drain timer leak
The composable's drain timer can leak on rapid successive resets if the previous interval is not cleared before a new one is started.

### Question answer map never cleaned up
Answers are accumulated in `Record<msgId, Record<question, Set<string>>>` and never pruned. Over a long session this is a slow memory leak.

### Hardcoded values
- Health check retry: 20 attempts × 500 ms = 10 s max wait — not configurable via env.
- CORS origin hardcoded to `http://localhost:3001`.
- Preview viewport widths hardcoded to `1440` and `375`.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Security | Medium | No HTTP API auth |
| Security | Medium | API key injected into containers |
| Security | Low | No chat input validation |
| Correctness | High | Session store lost on restart |
| Correctness | Medium | `restartingApps` race condition |
| Correctness | Medium | Session deleted mid-agent-run |
| Completeness | High | `POST /sessions/close` is a no-op |
| Completeness | Medium | Collaborators API not implemented |
| Type safety | Low | `as never` casts in Hono context and socket.data |
| Type safety | Low | Identity map in `mapSdkMessage` |
| Performance | Low | Sequential container recreation |
| Performance | Low | Polling-based status refresh |
| Reliability | Low | Silent error swallowing in `destroyContainer` |
| Memory | Low | Token smoothening timer leak |
| Memory | Low | Answer map never pruned |

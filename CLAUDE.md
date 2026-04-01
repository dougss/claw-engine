# CLAUDE.md — Claw Engine

> Model-agnostic coding agent factory. Decomposes features into parallelizable DAGs,
> routes tasks to cheapest viable model, manages session lifecycles via git worktrees.

## Stack

- **Runtime:** Node.js 22 (Homebrew node@22), TypeScript ESM (`"type": "module"`, `.js` imports)
- **API:** Fastify 5 + @fastify/cors + @fastify/static (port 3004)
- **Queue:** BullMQ 5 + Redis (127.0.0.1:6379)
- **DB:** PostgreSQL 16 via Drizzle ORM (database: `claw_engine`, user: `claw_engine`)
- **CLI:** Commander.js — `npm run claw -- <command>`
- **Dashboard:** React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts

## Key architecture files

| File                          | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `src/daemon.ts`               | Entry point — starts server, reconcile, signal handlers        |
| `src/server.ts`               | Fastify HTTP + SSE + static dashboard                          |
| `src/core/scheduler.ts`       | BullMQ DAG-aware orchestration                                 |
| `src/core/session-manager.ts` | Single session lifecycle with worktree                         |
| `src/core/router.ts`          | 3-layer model routing (keywords → budget → fallback)           |
| `src/core/decomposer.ts`      | Feature → WorkItemDAG via LLM                                  |
| `src/core/reconcile.ts`       | Startup reconciliation (orphan worktrees, interrupted tasks)   |
| `src/harness/agent-loop.ts`   | Streaming agentic loop with checkpoint trigger                 |
| `src/harness/model-adapters/` | alibaba-adapter (DashScope/OpenAI-compat), claude-pipe-adapter |
| `src/storage/repositories/`   | Drizzle repos: work-items, tasks, telemetry, routing, cost     |
| `src/integrations/`           | github, nexus, openclaw, mcp                                   |
| `src/cli/commands/`           | 15 CLI commands                                                |

## Conventions

- **RORO**: functions with 3+ params use `{ param1, param2, ... }` objects
- **No enums**: use `const OBJ = { ... } as const` + `typeof OBJ[keyof typeof OBJ]`
- **No classes** unless required by library (BullMQ, Fastify)
- **Tests**: Vitest — unit in `tests/unit/`, integration in `tests/integration/`
- **DB lazy singleton**: `getDb({ connectionString })` — call once, reuses pool

## Development

```bash
# Run tests
npm test                              # unit tests
npm run test:integration              # integration tests (needs DB + Redis)

# Type checking
npx tsc --noEmit

# CLI
npm run claw -- doctor               # health checks
npm run claw -- run <repo> "<prompt>" # single task
npm run claw -- submit "<desc>" --repos <r1,r2> # multi-task DAG

# Build
npm run build                         # tsc + dashboard build
```

## Environment variables

| Var                        | Default     | Description                |
| -------------------------- | ----------- | -------------------------- |
| `CLAW_ENGINE_DATABASE_URL` | from config | Postgres connection string |
| `CLAW_ENGINE_CONFIG`       | auto        | Path to config.yaml        |
| `DASHSCOPE_API_KEY`        | —           | Alibaba DashScope API key  |

## Port

**3004** (port 3003 is taken by Excalidraw Canvas Server)

## Database

- DB: `claw_engine`, User: `claw_engine`, Password: `claw_engine_local` (dev)
- Tables: `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`

## LaunchAgent

```bash
# Load
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist
# Status
launchctl list | grep claw-engine
# Logs
tail -f ~/server/logs/claw-engine.log
# Stop
launchctl unload ~/Library/LaunchAgents/dev.claw-engine.server.plist
```

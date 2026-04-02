# Claw Engine — Implementation Roadmap

> Tasks 6–19 from the production sprint (2026-04-01-claw-engine-production-sprint.md).
> Tasks 1–5 (withRetry, CLI wiring, events, Postgres SessionStore, auto-resume) are prerequisites completed before this tracking began.

| Task # | Title                                                                | Status        | Notes                                                                                 |
| ------ | -------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| 6      | Wire dead code — error classifier, health monitor, validation runner | Open          | Modules exist but are never called; needs orchestration-loop glue                     |
| 7      | Microcompact — clear stale tool results in-place                     | Open          | Add `microcompact()` to TranscriptStore; call before each pass in QueryEnginePort     |
| 8      | WorktreeTool — `enter_worktree` + `exit_worktree` built-in tools     | Open          | Expose existing `integrations/git/worktrees.ts` as agent-callable tools               |
| 9      | AgentTool — `spawn_agent` for sub-agent delegation                   | Open          | Depends on Task 8; max 3 concurrent sub-agents                                        |
| 10     | TaskTools — `task_create / list / update / get` agent tools          | Open          | Uses existing Drizzle `tasks` table; session ID as parent context                     |
| 11     | CLAUDE.md + AGENTS.md + .cursor/rules auto-loading                   | **Completed** | Auto-loaded in context-builder.ts; 10KB limit with truncation notice                  |
| 12     | Parallel tool execution within a turn                                | Open          | Concurrent-safe tools (read, glob, grep, web\_\*) run via Promise.all; max 5 parallel |
| 13     | Tool result size limiting                                            | Open          | Per-tool char limits (bash: 100k, grep: 50k, web_fetch: 51.2k)                        |
| 14     | Fallback chain execution in agent loop                               | Open          | Depends on Task 1 (withRetry); escalate tier-by-tier on retry exhaustion              |
| 15     | Wire MCP config inheritance from `~/.claude/settings.json`           | Open          | New `mcp-loader.ts`; inherit_from config key already in schema                        |
| 16     | Complete stub CLI commands: status, resume, cancel                   | Open          | Depends on Task 4 (Postgres SessionStore)                                             |
| 17     | Remote session support (iMac Pro workflow)                           | Open          | `POST /api/v1/run` + SSE stream; `claw run --remote mini`                             |
| 18     | NotebookEditTool — Jupyter cell editing                              | Open          | Parse .ipynb JSON; replace/insert/delete cells                                        |
| 19     | Orchestration loop — end-to-end daemon glue                          | Open          | Depends on Tasks 1, 4, 6, 8, 10; the missing piece connecting all components          |

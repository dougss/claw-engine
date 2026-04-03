# Spec: Parallel Tool Execution Within a Turn

GitHub Issue: #6

## Goal

When the model emits multiple `tool_use` events in a single turn, execute read-only (concurrency-safe) tools in parallel via `Promise.all()` while keeping mutating tools sequential. Max 5 concurrent tools per batch.

## Non-Goals

- Cross-turn parallelism (out of scope)
- Changing the message format (OpenAI wire format stays the same)
- Adding tool dependency graphs or resource locking

## Architecture

The change is localized to 2 files with a minor addition to a 3rd:

1. **`src/harness/tools/tool-types.ts`** — Add `isConcurrencySafe?: boolean` to `ToolHandler`
2. **`src/harness/agent-loop.ts`** — Collect all tool_use events from a turn, partition into safe/unsafe batches, execute accordingly
3. **`src/harness/tools/tool-registry.ts`** — No structural changes needed (tools self-declare via their handler)

### Concurrency-Safe Tools

These tools are read-only or stateless — safe to run in parallel:

| Tool         | Reason                     |
| ------------ | -------------------------- |
| `read_file`  | Filesystem read-only       |
| `glob`       | Filesystem scan, read-only |
| `grep`       | Filesystem scan, read-only |
| `web_fetch`  | Stateless HTTP GET         |
| `web_search` | Stateless HTTP GET         |
| `task_list`  | DB read-only               |
| `task_get`   | DB read-only               |

### NOT Concurrency-Safe (sequential execution)

| Tool             | Reason                                   |
| ---------------- | ---------------------------------------- |
| `bash`           | Arbitrary side effects                   |
| `write_file`     | Filesystem mutation                      |
| `edit_file`      | Read-modify-write race                   |
| `ask_user`       | Human I/O, must be serial                |
| `spawn_agent`    | Process spawn, has own concurrency limit |
| `enter_worktree` | Git state mutation                       |
| `exit_worktree`  | Git state mutation                       |
| `notebook_edit`  | File mutation                            |
| `task_create`    | DB write                                 |
| `task_update`    | DB write                                 |

### MCP Tools

MCP tools are **not** concurrency-safe by default (unknown side effects).

## Detailed Design

### Step 1: Extend ToolHandler interface

In `src/harness/tools/tool-types.ts`:

```typescript
export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  maxResultSizeChars?: number;
  isConcurrencySafe?: boolean; // NEW — defaults to false
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}
```

### Step 2: Mark safe tools

In each builtin file, add `isConcurrencySafe: true` to the handler object for: `read_file`, `glob`, `grep`, `web_fetch`, `web_search`, `task_list`, `task_get`.

Example in `read-file.ts`:

```typescript
export const readFileTool: ToolHandler = {
  name: "read_file",
  isConcurrencySafe: true, // ← ADD
  // ...rest unchanged
};
```

### Step 3: Refactor agent-loop.ts tool execution

**Current flow** (lines ~152-260): Inside `for await (event of adapter.chat())`, each `tool_use` event is processed immediately with `await executeTool()`.

**New flow**: Two-phase approach.

```
Phase 1: COLLECT
  - Stream all events from adapter.chat()
  - For text_delta, token_update: handle immediately (unchanged)
  - For tool_use: push to pendingToolCalls[] (do NOT execute yet)
  - Check permissions during collection (deny immediately if needed)

Phase 2: EXECUTE (after streaming ends)
  - Partition pendingToolCalls into:
    - safeBatch: all where handler.isConcurrencySafe === true
    - unsafeBatch: everything else (in original order)
  - Execute safeBatch via Promise.all() (max 5 concurrent via chunking)
  - Execute unsafeBatch sequentially (await one by one)
  - Merge results back in original tool_use order for message assembly
```

**Max concurrency constant:**

```typescript
const MAX_PARALLEL_TOOLS = 5;
```

**Chunking for safeBatch:**

```typescript
// If safeBatch has 8 items, execute in chunks of 5 then 3
for (let i = 0; i < safeBatch.length; i += MAX_PARALLEL_TOOLS) {
  const chunk = safeBatch.slice(i, i + MAX_PARALLEL_TOOLS);
  const results = await Promise.all(chunk.map((tc) => executeTool(tc)));
  // store results keyed by tool_use id
}
```

**Result ordering:** Use a `Map<string, ToolResult>` keyed by `tool_use.id`. After both batches complete, iterate `pendingToolCalls` in original order to build `turnToolResults` — preserving the order the model expects.

**Event yielding:** `tool_result` events should still be yielded in original order after execution completes, so SSE/dashboard consumers see a coherent stream.

### Step 4: Preserve message format

No changes to message assembly (lines 273-282). The assistant message still has `toolCalls[]` in original order, followed by individual tool result messages in the same order.

## Test Plan

All tests in `tests/unit/harness/agent-loop.test.ts`.

### Test 1: "executes concurrency-safe tools in parallel"

- Mock adapter returns 3 tool_use events in one turn: `read_file`, `glob`, `grep`
- All 3 handlers have `isConcurrencySafe: true`
- Assert all 3 `tool_result` events are yielded
- Assert execution happened in parallel (use timing or spy call order)

### Test 2: "executes unsafe tools sequentially"

- Mock adapter returns 2 tool_use events: `write_file`, `edit_file`
- Neither has `isConcurrencySafe: true`
- Assert execution is sequential (second starts after first completes)

### Test 3: "mixed batch — safe parallel + unsafe sequential"

- Mock adapter returns 4 tool_use events: `read_file`, `grep`, `bash`, `write_file`
- Assert `read_file` and `grep` run in parallel
- Assert `bash` and `write_file` run sequentially (after safe batch)
- Assert all 4 results are in original order in messages

### Test 4: "respects MAX_PARALLEL_TOOLS limit"

- Mock adapter returns 8 concurrency-safe tool_use events
- Assert no more than 5 execute concurrently (use a concurrency counter in mock handlers)

### Test 5: "permission denied tools are excluded from batches"

- Mock adapter returns 3 tool_use events, one is denied by permission rules
- Assert denied tool gets error result immediately
- Assert remaining 2 tools execute normally

### Test 6: "MCP tools execute sequentially"

- Register an MCP tool, mock adapter calls it alongside safe builtins
- Assert MCP tool runs sequentially (not in parallel batch)

### Test 7: "tool results preserve original order"

- Mock 5 tools where later ones complete faster than earlier ones
- Assert `turnToolResults` and yielded `tool_result` events match original `tool_use` order

### Test 8: "existing single-tool behavior unchanged"

- Single tool_use per turn (existing test) still works identically

## Acceptance Criteria

1. Multiple `read_file`/`glob`/`grep` in a turn run in parallel (measurable via timing)
2. `bash`/`write_file`/`edit_file` always run sequentially
3. All existing tests pass without modification
4. Message format unchanged (OpenAI wire compatible)
5. Max 5 parallel tools per batch
6. Tool results in messages preserve original tool_use order

## Files Changed

| File                                       | Change                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `src/harness/tools/tool-types.ts`          | Add `isConcurrencySafe?: boolean` to interface                    |
| `src/harness/tools/builtins/read-file.ts`  | Add `isConcurrencySafe: true`                                     |
| `src/harness/tools/builtins/glob-tool.ts`  | Add `isConcurrencySafe: true`                                     |
| `src/harness/tools/builtins/grep-tool.ts`  | Add `isConcurrencySafe: true`                                     |
| `src/harness/tools/builtins/web-fetch.ts`  | Add `isConcurrencySafe: true`                                     |
| `src/harness/tools/builtins/web-search.ts` | Add `isConcurrencySafe: true`                                     |
| `src/harness/tools/builtins/task-tools.ts` | Add `isConcurrencySafe: true` to `taskListTool` and `taskGetTool` |
| `src/harness/agent-loop.ts`                | Refactor tool execution to collect→partition→execute              |
| `tests/unit/harness/agent-loop.test.ts`    | Add 7 new test cases                                              |

# Claw Engine — claw-code Architectural Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the claw-engine harness layer to incorporate claw-code's proven architectural patterns (QueryEngineConfig, TranscriptStore, SessionStore, QueryEnginePort, ToolPool), wrapping the existing working agent-loop without rewriting it.

**Architecture:** Bottom-up build of 6 new modules in `src/harness/`, then create a `QueryEnginePort` orchestrator that **calls** `runAgentLoop` as its inner loop and layers compaction/persistence on top of the events it yields. Each module is independently testable. The existing 110 tests must continue passing — we're adding orchestration on top, not replacing internals. The key win is transcript compaction at 70% token usage (session continues) before the existing checkpoint at 85% (session dies).

**Tech Stack:** Node.js 22, TypeScript (ESM), Vitest, existing Drizzle ORM + PostgreSQL schema (`tasks.checkpoint_data` JSONB column).

**Key constraint:** Do NOT change files outside `src/harness/`, `src/core/session-manager.ts`, and `tests/` unless absolutely necessary. The Router, Scheduler, DAG decomposer, CLI, API, Dashboard — all stay untouched.

---

## File Structure (locked-in decomposition)

### New files

| File                                 | Responsibility                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `src/harness/query-engine-config.ts` | Centralized session config type + defaults + validation                         |
| `src/harness/transcript-store.ts`    | Conversation transcript with auto-compaction                                    |
| `src/harness/session-store.ts`       | Session state persistence (save/load/list/delete)                               |
| `src/harness/usage-tracker.ts`       | Per-turn token/tool/denial aggregation                                          |
| `src/harness/tool-pool.ts`           | Tool assembly with profiles and filtering                                       |
| `src/harness/query-engine-port.ts`   | Orchestrator that calls `runAgentLoop` and layers compaction/persistence on top |

### Modified files

| File                                 | What changes                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/harness/agent-loop.ts`          | No structural changes. `runAgentLoop` stays as-is. QueryEnginePort wraps it by iterating its events and layering compaction/persistence on top. |
| `src/harness/events.ts`              | Add `compaction` event type                                                                                                                     |
| `src/core/session-manager.ts`        | Rewrite to use `QueryEnginePort` instead of directly calling `runAgentLoop`                                                                     |
| `src/harness/tools/tool-registry.ts` | Add `getToolsByNames()` and `clearRegistry()` helpers                                                                                           |

### New test files

| File                                             | Tests for                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `tests/unit/harness/query-engine-config.test.ts` | Config creation, defaults, validation                                       |
| `tests/unit/harness/transcript-store.test.ts`    | Append, compaction, serialization                                           |
| `tests/unit/harness/session-store.test.ts`       | Save/load/delete roundtrips                                                 |
| `tests/unit/harness/usage-tracker.test.ts`       | Per-turn aggregation, denial counting                                       |
| `tests/unit/harness/tool-pool.test.ts`           | Profile assembly, filtering, custom tools                                   |
| `tests/unit/harness/query-engine-port.test.ts`   | Full orchestrated flow, compaction mid-session, checkpoint fallback, resume |

---

## Task 1: QueryEngineConfig — centralized session configuration

**Files:**

- Create: `src/harness/query-engine-config.ts`
- Test: `tests/unit/harness/query-engine-config.test.ts`

### What this does

Every function in the harness currently receives 8+ scattered parameters (`maxIterations`, `tokenBudget`, `workspacePath`, `checkpointThresholdPercent`, etc.). QueryEngineConfig centralizes them into a single typed object with validated defaults — matching how claw-code's `QueryEngineConfig` holds `max_turns`, `max_budget_tokens`, `compact_after_turns`, etc.

- [ ] **Step 1: Write failing tests for QueryEngineConfig**

```typescript
import { describe, it, expect } from "vitest";
import {
  createQueryEngineConfig,
  DEFAULT_QUERY_ENGINE_CONFIG,
  TOOL_PROFILE,
  TOKEN_BUDGET_MODE,
  type QueryEngineConfig,
} from "../../../src/harness/query-engine-config.js";

describe("QueryEngineConfig", () => {
  it("creates config with all defaults", () => {
    const config = createQueryEngineConfig({});
    expect(config.maxTurns).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTurns);
    expect(config.maxTokens).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTokens);
    expect(config.tokenBudgetMode).toBe(TOKEN_BUDGET_MODE.adaptive);
    expect(config.warningThreshold).toBe(0.75);
    expect(config.checkpointThreshold).toBe(0.85);
    expect(config.compactionThreshold).toBe(0.7);
    expect(config.compactionPreserveMessages).toBe(4);
    expect(config.compactionEnabled).toBe(true);
    expect(config.toolProfile).toBe(TOOL_PROFILE.full);
    expect(config.reserveForSummary).toBe(10_000);
  });

  it("overrides specific fields while keeping other defaults", () => {
    const config = createQueryEngineConfig({
      maxTurns: 50,
      toolProfile: TOOL_PROFILE.readonly,
      compactionEnabled: false,
    });
    expect(config.maxTurns).toBe(50);
    expect(config.toolProfile).toBe(TOOL_PROFILE.readonly);
    expect(config.compactionEnabled).toBe(false);
    expect(config.maxTokens).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTokens);
  });

  it("rejects compactionThreshold >= checkpointThreshold", () => {
    expect(() =>
      createQueryEngineConfig({
        compactionThreshold: 0.9,
        checkpointThreshold: 0.85,
      }),
    ).toThrow("compactionThreshold must be less than checkpointThreshold");
  });

  it("rejects maxTurns <= 0", () => {
    expect(() => createQueryEngineConfig({ maxTurns: 0 })).toThrow(
      "maxTurns must be positive",
    );
  });

  it("rejects maxTokens <= 0", () => {
    expect(() => createQueryEngineConfig({ maxTokens: -1 })).toThrow(
      "maxTokens must be positive",
    );
  });

  it("allows custom tool profile with allowedTools", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.custom,
      allowedTools: ["read_file", "grep"],
    });
    expect(config.toolProfile).toBe(TOOL_PROFILE.custom);
    expect(config.allowedTools).toEqual(["read_file", "grep"]);
  });

  it("rejects custom profile without allowedTools", () => {
    expect(() =>
      createQueryEngineConfig({
        toolProfile: TOOL_PROFILE.custom,
      }),
    ).toThrow("allowedTools required when toolProfile is 'custom'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/query-engine-config.test.ts
```

Expected: FAIL — module `query-engine-config.js` does not exist.

- [ ] **Step 3: Implement QueryEngineConfig**

```typescript
// src/harness/query-engine-config.ts

export const TOOL_PROFILE = {
  full: "full",
  simple: "simple",
  readonly: "readonly",
  custom: "custom",
} as const;

export type ToolProfile = (typeof TOOL_PROFILE)[keyof typeof TOOL_PROFILE];

export const TOKEN_BUDGET_MODE = {
  strict: "strict",
  adaptive: "adaptive",
} as const;

export type TokenBudgetMode =
  (typeof TOKEN_BUDGET_MODE)[keyof typeof TOKEN_BUDGET_MODE];

export interface QueryEngineConfig {
  maxTurns: number;
  maxTokens: number;

  tokenBudgetMode: TokenBudgetMode;
  warningThreshold: number;
  checkpointThreshold: number;
  reserveForSummary: number;

  compactionEnabled: boolean;
  compactionThreshold: number;
  compactionPreserveMessages: number;

  toolProfile: ToolProfile;
  allowedTools?: string[];

  workspacePath: string;
  sessionId: string;
}

export const DEFAULT_QUERY_ENGINE_CONFIG = {
  maxTurns: 200,
  maxTokens: 128_000,
  tokenBudgetMode: TOKEN_BUDGET_MODE.adaptive as TokenBudgetMode,
  warningThreshold: 0.75,
  checkpointThreshold: 0.85,
  reserveForSummary: 10_000,
  compactionEnabled: true,
  compactionThreshold: 0.7,
  compactionPreserveMessages: 4,
  toolProfile: TOOL_PROFILE.full as ToolProfile,
  workspacePath: "/tmp",
  sessionId: "default",
} as const;

export function createQueryEngineConfig(
  overrides: Partial<QueryEngineConfig>,
): QueryEngineConfig {
  const config: QueryEngineConfig = {
    maxTurns: overrides.maxTurns ?? DEFAULT_QUERY_ENGINE_CONFIG.maxTurns,
    maxTokens: overrides.maxTokens ?? DEFAULT_QUERY_ENGINE_CONFIG.maxTokens,
    tokenBudgetMode:
      overrides.tokenBudgetMode ?? DEFAULT_QUERY_ENGINE_CONFIG.tokenBudgetMode,
    warningThreshold:
      overrides.warningThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.warningThreshold,
    checkpointThreshold:
      overrides.checkpointThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.checkpointThreshold,
    reserveForSummary:
      overrides.reserveForSummary ??
      DEFAULT_QUERY_ENGINE_CONFIG.reserveForSummary,
    compactionEnabled:
      overrides.compactionEnabled ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionEnabled,
    compactionThreshold:
      overrides.compactionThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionThreshold,
    compactionPreserveMessages:
      overrides.compactionPreserveMessages ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionPreserveMessages,
    toolProfile:
      overrides.toolProfile ?? DEFAULT_QUERY_ENGINE_CONFIG.toolProfile,
    allowedTools: overrides.allowedTools,
    workspacePath:
      overrides.workspacePath ?? DEFAULT_QUERY_ENGINE_CONFIG.workspacePath,
    sessionId: overrides.sessionId ?? DEFAULT_QUERY_ENGINE_CONFIG.sessionId,
  };

  if (config.maxTurns <= 0) {
    throw new Error("maxTurns must be positive");
  }
  if (config.maxTokens <= 0) {
    throw new Error("maxTokens must be positive");
  }
  if (config.compactionThreshold >= config.checkpointThreshold) {
    throw new Error(
      "compactionThreshold must be less than checkpointThreshold",
    );
  }
  if (config.toolProfile === TOOL_PROFILE.custom && !config.allowedTools) {
    throw new Error("allowedTools required when toolProfile is 'custom'");
  }

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/query-engine-config.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run all existing tests to verify nothing broke**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all 110+ existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/query-engine-config.ts tests/unit/harness/query-engine-config.test.ts && git commit -m "feat(harness): add QueryEngineConfig centralized session configuration"
```

---

## Task 2: TranscriptStore — conversation transcript with auto-compaction

**Files:**

- Create: `src/harness/transcript-store.ts`
- Test: `tests/unit/harness/transcript-store.test.ts`

### What this does

Mirrors claw-code's `TranscriptStore` (from `transcript.py`) but adapted for the claw-engine's `Message` type. The key feature is **compaction**: when token usage hits 70%, old messages are summarized by the model and replaced with a single system message containing the summary, preserving only the N most recent messages. This lets sessions continue working instead of dying at the checkpoint threshold.

claw-code's version is simple (just slices a list). Ours needs to actually call the model for summarization because our messages contain rich tool call/result pairs, not just strings.

- [ ] **Step 1: Write failing tests for TranscriptStore**

```typescript
import { describe, it, expect } from "vitest";
import {
  createTranscriptStore,
  type TranscriptStore,
} from "../../../src/harness/transcript-store.js";
import type { Message } from "../../../src/types.js";
import type { QueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";

function makeConfig(
  overrides: Partial<QueryEngineConfig> = {},
): QueryEngineConfig {
  return createQueryEngineConfig({
    compactionEnabled: true,
    compactionThreshold: 0.7,
    compactionPreserveMessages: 2,
    maxTokens: 1000,
    ...overrides,
  });
}

describe("TranscriptStore", () => {
  it("starts with initial system and user messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "You are a helper.",
      userPrompt: "Do X.",
    });
    const msgs = store.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("appends assistant messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("Hello!");
    expect(store.getMessages()).toHaveLength(3);
    expect(store.getMessages()[2]).toEqual({
      role: "assistant",
      content: "Hello!",
    });
  });

  it("appends tool result messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addToolResult({
      toolUseId: "t1",
      toolName: "read_file",
      output: "file contents",
    });
    const last = store.getMessages()[2];
    expect(last.role).toBe("tool");
    expect(last.toolUseId).toBe("t1");
  });

  it("getRecentMessages returns the last N messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");

    const recent = store.getRecentMessages(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("msg2");
    expect(recent[1].content).toBe("msg3");
  });

  it("estimateTokens returns rough char/4 count", () => {
    const store = createTranscriptStore({
      systemPrompt: "a".repeat(400),
      userPrompt: "b".repeat(400),
    });
    const tokens = store.estimateTokens();
    expect(tokens).toBeGreaterThanOrEqual(200);
    expect(tokens).toBeLessThanOrEqual(210);
  });

  it("shouldCompact returns false when below threshold", () => {
    const config = makeConfig();
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    expect(store.shouldCompact({ config, currentTokenPercent: 50 })).toBe(
      false,
    );
  });

  it("shouldCompact returns true when above threshold", () => {
    const config = makeConfig();
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(true);
  });

  it("shouldCompact returns false when compaction is disabled", () => {
    const config = makeConfig({ compactionEnabled: false });
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(
      false,
    );
  });

  it("shouldCompact returns false when not enough messages to compact", () => {
    const config = makeConfig({ compactionPreserveMessages: 10 });
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(
      false,
    );
  });

  it("compact replaces old messages with summary + preserves recent", async () => {
    const config = makeConfig({ compactionPreserveMessages: 2 });
    const adapter = createMockAdapter({
      name: "compact-mock",
      responses: [
        [{ type: "text_delta", text: "Summary of conversation so far." }],
      ],
    });

    const store = createTranscriptStore({
      systemPrompt: "You are a helper.",
      userPrompt: "Do task A.",
    });
    store.addAssistantMessage("Working on A...");
    store.addAssistantMessage("Done with part 1.");
    store.addAssistantMessage("Working on part 2.");
    store.addAssistantMessage("Almost done.");

    expect(store.getMessages()).toHaveLength(6);
    expect(store.compactionCount).toBe(0);
    expect(store.isFlushed).toBe(false);

    await store.compact({ config, adapter });

    const msgs = store.getMessages();
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helper.");
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("Summary of conversation so far.");
    expect(msgs[msgs.length - 2].content).toBe("Working on part 2.");
    expect(msgs[msgs.length - 1].content).toBe("Almost done.");
    expect(store.compactionCount).toBe(1);
    expect(store.isFlushed).toBe(true);
  });

  it("multiple compactions increment compactionCount", async () => {
    const config = makeConfig({ compactionPreserveMessages: 1 });
    const adapter = createMockAdapter({
      name: "compact-mock",
      responses: [
        [{ type: "text_delta", text: "Summary 1" }],
        [{ type: "text_delta", text: "Summary 2" }],
      ],
    });

    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "go",
    });
    store.addAssistantMessage("a");
    store.addAssistantMessage("b");
    store.addAssistantMessage("c");
    await store.compact({ config, adapter });
    expect(store.compactionCount).toBe(1);

    store.addAssistantMessage("d");
    store.addAssistantMessage("e");
    await store.compact({ config, adapter });
    expect(store.compactionCount).toBe(2);
  });

  it("toSerializable/fromSerializable roundtrip", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("hello");

    const serialized = store.toSerializable();
    const restored = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
      fromSerialized: serialized,
    });

    expect(restored.getMessages()).toEqual(store.getMessages());
    expect(restored.compactionCount).toBe(store.compactionCount);
    expect(restored.isFlushed).toBe(store.isFlushed);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/transcript-store.test.ts
```

Expected: FAIL — module `transcript-store.js` does not exist.

- [ ] **Step 3: Implement TranscriptStore**

```typescript
// src/harness/transcript-store.ts

import type { Message } from "../types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";

const COMPACTION_SYSTEM_PROMPT =
  "Summarize the conversation below concisely. Focus on: what was accomplished, what decisions were made, what still needs to be done. Be brief but preserve key context.";

export interface SerializedTranscript {
  messages: Message[];
  compactionCount: number;
  isFlushed: boolean;
}

export interface TranscriptStore {
  compactionCount: number;
  isFlushed: boolean;

  addAssistantMessage(content: string): void;
  addToolResult(params: {
    toolUseId: string;
    toolName: string;
    output: string;
  }): void;

  shouldCompact(params: {
    config: QueryEngineConfig;
    currentTokenPercent: number;
  }): boolean;
  compact(params: {
    config: QueryEngineConfig;
    adapter: ModelAdapter;
  }): Promise<void>;

  getMessages(): Message[];
  getRecentMessages(n: number): Message[];
  estimateTokens(): number;
  toSerializable(): SerializedTranscript;
}

export function createTranscriptStore({
  systemPrompt,
  userPrompt,
  fromSerialized,
}: {
  systemPrompt: string;
  userPrompt: string;
  fromSerialized?: SerializedTranscript;
}): TranscriptStore {
  let messages: Message[] = fromSerialized
    ? [...fromSerialized.messages]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
  let compactionCount = fromSerialized?.compactionCount ?? 0;
  let isFlushed = fromSerialized?.isFlushed ?? false;
  const originalSystemPrompt = systemPrompt;

  function addAssistantMessage(content: string) {
    messages.push({ role: "assistant", content });
    isFlushed = false;
  }

  function addToolResult({
    toolUseId,
    toolName,
    output,
  }: {
    toolUseId: string;
    toolName: string;
    output: string;
  }) {
    messages.push({ role: "tool", content: output, toolUseId, toolName });
    isFlushed = false;
  }

  function shouldCompact({
    config,
    currentTokenPercent,
  }: {
    config: QueryEngineConfig;
    currentTokenPercent: number;
  }): boolean {
    if (!config.compactionEnabled) return false;
    if (currentTokenPercent < config.compactionThreshold * 100) return false;
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    if (nonSystemMessages.length <= config.compactionPreserveMessages) {
      return false;
    }
    return true;
  }

  async function compact({
    config,
    adapter,
  }: {
    config: QueryEngineConfig;
    adapter: ModelAdapter;
  }): Promise<void> {
    const preserveCount = config.compactionPreserveMessages;
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    if (nonSystemMessages.length <= preserveCount) return;

    const toSummarize = nonSystemMessages.slice(
      0,
      nonSystemMessages.length - preserveCount,
    );
    const toPreserve = nonSystemMessages.slice(
      nonSystemMessages.length - preserveCount,
    );

    const summaryMessages: Message[] = [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: toSummarize.map((m) => `[${m.role}]: ${m.content}`).join("\n"),
      },
    ];

    let summaryText = "";
    for await (const event of adapter.chat(summaryMessages, [])) {
      if (event.type === "text_delta") {
        summaryText += event.text;
      }
    }

    messages = [
      { role: "system", content: originalSystemPrompt },
      {
        role: "system",
        content: `[Compacted transcript — summary of ${toSummarize.length} messages]\n${summaryText}`,
      },
      ...toPreserve,
    ];

    compactionCount++;
    isFlushed = true;
  }

  function getMessages(): Message[] {
    return [...messages];
  }

  function getRecentMessages(n: number): Message[] {
    return messages.slice(-n);
  }

  function estimateTokens(): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  function toSerializable(): SerializedTranscript {
    return {
      messages: [...messages],
      compactionCount,
      isFlushed,
    };
  }

  return {
    get compactionCount() {
      return compactionCount;
    },
    get isFlushed() {
      return isFlushed;
    },
    addAssistantMessage,
    addToolResult,
    shouldCompact,
    compact,
    getMessages,
    getRecentMessages,
    estimateTokens,
    toSerializable,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/transcript-store.test.ts
```

Expected: all 12 tests PASS.

- [ ] **Step 5: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/transcript-store.ts tests/unit/harness/transcript-store.test.ts && git commit -m "feat(harness): add TranscriptStore with auto-compaction support"
```

---

## Task 3: UsageTracker — per-turn token/tool/denial aggregation

**Files:**

- Create: `src/harness/usage-tracker.ts`
- Test: `tests/unit/harness/usage-tracker.test.ts`

### What this does

Mirrors claw-code's `UsageSummary.add_turn()` pattern but tracks more metrics. Aggregates input/output tokens, tool call count, permission denial count per session. The existing `token-budget.ts` has stateless functions; UsageTracker is stateful and accumulates across turns.

- [ ] **Step 1: Write failing tests for UsageTracker**

```typescript
import { describe, it, expect } from "vitest";
import {
  createUsageTracker,
  type UsageTracker,
} from "../../../src/harness/usage-tracker.js";

describe("UsageTracker", () => {
  it("starts with zeroes", () => {
    const tracker = createUsageTracker();
    const summary = tracker.getSummary();
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.turnCount).toBe(0);
    expect(summary.toolCallCount).toBe(0);
    expect(summary.permissionDenialCount).toBe(0);
  });

  it("addTurn accumulates tokens and increments turnCount", () => {
    const tracker = createUsageTracker();
    tracker.addTurn({ inputTokens: 100, outputTokens: 50 });
    tracker.addTurn({ inputTokens: 200, outputTokens: 80 });
    const summary = tracker.getSummary();
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(130);
    expect(summary.turnCount).toBe(2);
  });

  it("addToolCall increments tool count", () => {
    const tracker = createUsageTracker();
    tracker.addToolCall();
    tracker.addToolCall();
    tracker.addToolCall();
    expect(tracker.getSummary().toolCallCount).toBe(3);
  });

  it("addPermissionDenial increments denial count", () => {
    const tracker = createUsageTracker();
    tracker.addPermissionDenial();
    expect(tracker.getSummary().permissionDenialCount).toBe(1);
  });

  it("currentPercent computes usage percentage from latest token_update", () => {
    const tracker = createUsageTracker();
    tracker.updateTokenPercent(65);
    expect(tracker.currentPercent).toBe(65);
    tracker.updateTokenPercent(72);
    expect(tracker.currentPercent).toBe(72);
  });

  it("toSerializable roundtrips through fromSerializable", () => {
    const tracker = createUsageTracker();
    tracker.addTurn({ inputTokens: 500, outputTokens: 200 });
    tracker.addToolCall();
    tracker.addPermissionDenial();
    tracker.updateTokenPercent(40);

    const serialized = tracker.toSerializable();
    const restored = createUsageTracker({ fromSerialized: serialized });
    expect(restored.getSummary()).toEqual(tracker.getSummary());
    expect(restored.currentPercent).toBe(40);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/usage-tracker.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement UsageTracker**

```typescript
// src/harness/usage-tracker.ts

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  toolCallCount: number;
  permissionDenialCount: number;
}

export interface SerializedUsage extends UsageSummary {
  currentPercent: number;
}

export interface UsageTracker {
  currentPercent: number;
  addTurn(params: { inputTokens: number; outputTokens: number }): void;
  addToolCall(): void;
  addPermissionDenial(): void;
  updateTokenPercent(percent: number): void;
  getSummary(): UsageSummary;
  toSerializable(): SerializedUsage;
}

export function createUsageTracker(opts?: {
  fromSerialized?: SerializedUsage;
}): UsageTracker {
  let totalInputTokens = opts?.fromSerialized?.totalInputTokens ?? 0;
  let totalOutputTokens = opts?.fromSerialized?.totalOutputTokens ?? 0;
  let turnCount = opts?.fromSerialized?.turnCount ?? 0;
  let toolCallCount = opts?.fromSerialized?.toolCallCount ?? 0;
  let permissionDenialCount = opts?.fromSerialized?.permissionDenialCount ?? 0;
  let currentPercent = opts?.fromSerialized?.currentPercent ?? 0;

  return {
    get currentPercent() {
      return currentPercent;
    },

    addTurn({ inputTokens, outputTokens }) {
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      turnCount++;
    },

    addToolCall() {
      toolCallCount++;
    },

    addPermissionDenial() {
      permissionDenialCount++;
    },

    updateTokenPercent(percent: number) {
      currentPercent = percent;
    },

    getSummary(): UsageSummary {
      return {
        totalInputTokens,
        totalOutputTokens,
        turnCount,
        toolCallCount,
        permissionDenialCount,
      };
    },

    toSerializable(): SerializedUsage {
      return {
        totalInputTokens,
        totalOutputTokens,
        turnCount,
        toolCallCount,
        permissionDenialCount,
        currentPercent,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/usage-tracker.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/usage-tracker.ts tests/unit/harness/usage-tracker.test.ts && git commit -m "feat(harness): add UsageTracker per-turn aggregation"
```

---

## Task 4: ToolPool — tool assembly with profiles + clearRegistry helper

**Files:**

- Create: `src/harness/tool-pool.ts`
- Modify: `src/harness/tools/tool-registry.ts` (add `getToolsByNames` and `clearRegistry`)
- Test: `tests/unit/harness/tool-pool.test.ts`

### What this does

Mirrors claw-code's `tool_pool.py` `assemble_tool_pool(simple_mode, include_mcp, permission_context)`. Currently the `tool-registry.ts` is a flat global Map with no concept of profiles. ToolPool adds profile-based filtering: `full` (all 7 builtins), `simple` (no bash/write/edit), `readonly` (read_file/glob/grep only), `custom` (explicit list).

Also adds `clearRegistry()` to `tool-registry.ts` so tests can reset the global state between test cases.

- [ ] **Step 1: Write failing tests for ToolPool**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  assembleToolPool,
  TOOL_PROFILES,
} from "../../../src/harness/tool-pool.js";
import {
  createQueryEngineConfig,
  TOOL_PROFILE,
} from "../../../src/harness/query-engine-config.js";
import {
  registerTool,
  clearRegistry,
} from "../../../src/harness/tools/tool-registry.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";

function makeDummyTool(name: string): ToolHandler {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {},
    execute: async () => ({ output: "ok", isError: false }),
  };
}

describe("ToolPool", () => {
  beforeEach(() => {
    clearRegistry();
    for (const name of [
      "bash",
      "read_file",
      "write_file",
      "edit_file",
      "glob",
      "grep",
      "ask_user",
    ]) {
      registerTool(makeDummyTool(name));
    }
  });

  it("full profile includes all 7 builtins", () => {
    const config = createQueryEngineConfig({ toolProfile: TOOL_PROFILE.full });
    const pool = assembleToolPool({ config });
    expect(pool.tools.length).toBe(7);
    expect(pool.toolNames).toContain("bash");
    expect(pool.toolNames).toContain("write_file");
  });

  it("simple profile excludes bash, write_file, edit_file", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.simple,
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).not.toContain("bash");
    expect(pool.toolNames).not.toContain("write_file");
    expect(pool.toolNames).not.toContain("edit_file");
    expect(pool.toolNames).toContain("read_file");
    expect(pool.toolNames).toContain("glob");
    expect(pool.toolNames).toContain("grep");
    expect(pool.toolNames).toContain("ask_user");
  });

  it("readonly profile includes only read_file, glob, grep", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).toEqual(
      expect.arrayContaining(["read_file", "glob", "grep"]),
    );
    expect(pool.toolNames).toHaveLength(3);
  });

  it("custom profile uses allowedTools list", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.custom,
      allowedTools: ["read_file", "grep"],
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).toEqual(
      expect.arrayContaining(["read_file", "grep"]),
    );
    expect(pool.toolNames).toHaveLength(2);
  });

  it("getDefinitions returns ToolDefinition array", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    const defs = pool.getDefinitions();
    expect(defs[0]).toHaveProperty("name");
    expect(defs[0]).toHaveProperty("description");
    expect(defs[0]).toHaveProperty("inputSchema");
  });

  it("getHandler returns handler by name", () => {
    const config = createQueryEngineConfig({ toolProfile: TOOL_PROFILE.full });
    const pool = assembleToolPool({ config });
    const handler = pool.getHandler("bash");
    expect(handler).not.toBeNull();
    expect(handler?.name).toBe("bash");
  });

  it("getHandler returns null for tool not in profile", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    expect(pool.getHandler("bash")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/tool-pool.test.ts
```

Expected: FAIL — `clearRegistry` and `tool-pool.js` do not exist.

- [ ] **Step 3: Add `getToolsByNames` and `clearRegistry` to tool-registry.ts**

Add these two functions to the end of `src/harness/tools/tool-registry.ts`, after the existing `registerMcpTools` function:

```typescript
export function getToolsByNames(names: string[]): ToolHandler[] {
  const result: ToolHandler[] = [];
  for (const name of names) {
    const handler = toolsByName.get(name);
    if (handler) result.push(handler);
  }
  return result;
}

export function clearRegistry(): void {
  toolsByName.clear();
  mcpToolsByName.clear();
}
```

The file `src/harness/tools/tool-registry.ts` should look like this after the change (showing full file):

```typescript
import type { ToolDefinition } from "../../types.js";
import type { ToolHandler } from "./tool-types.js";

const toolsByName = new Map<string, ToolHandler>();
const mcpToolsByName = new Map<string, ToolDefinition>();

export function registerTool(handler: ToolHandler) {
  toolsByName.set(handler.name, handler);
}

export function getTool(name: string) {
  return toolsByName.get(name) ?? null;
}

export function isMcpTool(name: string) {
  return mcpToolsByName.has(name);
}

export function getAllTools() {
  return Array.from(toolsByName.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  const builtins = getAllTools().map((handler) => ({
    name: handler.name,
    description: handler.description,
    inputSchema: handler.inputSchema,
  }));

  return [...builtins, ...mcpToolsByName.values()];
}

export function registerMcpTools(tools: ToolDefinition[]): void {
  for (const tool of tools) {
    if (toolsByName.has(tool.name)) continue;
    mcpToolsByName.set(tool.name, tool);
  }
}

export function getToolsByNames(names: string[]): ToolHandler[] {
  const result: ToolHandler[] = [];
  for (const name of names) {
    const handler = toolsByName.get(name);
    if (handler) result.push(handler);
  }
  return result;
}

export function clearRegistry(): void {
  toolsByName.clear();
  mcpToolsByName.clear();
}
```

- [ ] **Step 4: Implement ToolPool**

```typescript
// src/harness/tool-pool.ts

import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "./tools/tool-types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import { TOOL_PROFILE } from "./query-engine-config.js";
import { getToolsByNames } from "./tools/tool-registry.js";

export const TOOL_PROFILES: Record<string, string[]> = {
  [TOOL_PROFILE.full]: [
    "bash",
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "ask_user",
  ],
  [TOOL_PROFILE.simple]: ["read_file", "glob", "grep", "ask_user"],
  [TOOL_PROFILE.readonly]: ["read_file", "glob", "grep"],
  [TOOL_PROFILE.custom]: [],
};

export interface ToolPool {
  tools: ToolHandler[];
  toolNames: string[];
  getDefinitions(): ToolDefinition[];
  getHandler(name: string): ToolHandler | null;
}

export function assembleToolPool({
  config,
}: {
  config: QueryEngineConfig;
}): ToolPool {
  const profileNames =
    config.toolProfile === TOOL_PROFILE.custom
      ? (config.allowedTools ?? [])
      : (TOOL_PROFILES[config.toolProfile] ?? TOOL_PROFILES[TOOL_PROFILE.full]);

  const tools = getToolsByNames(profileNames);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return {
    tools,
    get toolNames() {
      return tools.map((t) => t.name);
    },

    getDefinitions(): ToolDefinition[] {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },

    getHandler(name: string): ToolHandler | null {
      return toolMap.get(name) ?? null;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/tool-pool.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS. The `clearRegistry` function is additive — existing tests don't call it, so they're unaffected.

- [ ] **Step 7: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/tool-pool.ts src/harness/tools/tool-registry.ts tests/unit/harness/tool-pool.test.ts && git commit -m "feat(harness): add ToolPool with profile-based tool assembly"
```

---

## Task 5: SessionStore — session state persistence

**Files:**

- Create: `src/harness/session-store.ts`
- Test: `tests/unit/harness/session-store.test.ts`

### What this does

Mirrors claw-code's `session_store.py` `save_session`/`load_session` but uses the existing PostgreSQL `tasks.checkpoint_data` JSONB column instead of filesystem JSON. The interface is backend-agnostic — we implement a PostgreSQL backend and an in-memory backend (for tests).

The `SessionState` type structures what currently lives as loose JSONB in `checkpoint_data`. It includes: config snapshot, serialized transcript, usage summary, and metadata.

- [ ] **Step 1: Write failing tests for SessionStore**

```typescript
import { describe, it, expect } from "vitest";
import {
  createMemorySessionStore,
  type SessionState,
  type SessionStore,
} from "../../../src/harness/session-store.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";

function makeSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    config: createQueryEngineConfig({ sessionId, workspacePath: "/tmp/test" }),
    transcript: {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      compactionCount: 0,
      isFlushed: false,
    },
    usage: {
      totalInputTokens: 500,
      totalOutputTokens: 200,
      turnCount: 3,
      toolCallCount: 5,
      permissionDenialCount: 1,
      currentPercent: 42,
    },
    metadata: {
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: "running",
    },
  };
}

describe("SessionStore (memory backend)", () => {
  it("save and load roundtrip", async () => {
    const store = createMemorySessionStore();
    const state = makeSessionState("sess-1");
    await store.save(state);
    const loaded = await store.load("sess-1");
    expect(loaded).toEqual(state);
  });

  it("load returns null for non-existent session", async () => {
    const store = createMemorySessionStore();
    expect(await store.load("nope")).toBeNull();
  });

  it("exists returns true for saved session", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("sess-2"));
    expect(await store.exists("sess-2")).toBe(true);
    expect(await store.exists("nope")).toBe(false);
  });

  it("delete removes session", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("sess-3"));
    await store.delete("sess-3");
    expect(await store.load("sess-3")).toBeNull();
  });

  it("list returns all session IDs", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("a"));
    await store.save(makeSessionState("b"));
    await store.save(makeSessionState("c"));
    const ids = await store.list();
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("save overwrites existing session", async () => {
    const store = createMemorySessionStore();
    const original = makeSessionState("sess-4");
    await store.save(original);

    const updated = {
      ...original,
      usage: { ...original.usage, turnCount: 10 },
    };
    await store.save(updated);

    const loaded = await store.load("sess-4");
    expect(loaded?.usage.turnCount).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/session-store.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement SessionStore**

```typescript
// src/harness/session-store.ts

import type { Message } from "../types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import type { SerializedUsage } from "./usage-tracker.js";
import type { SerializedTranscript } from "./transcript-store.js";

export interface SessionState {
  sessionId: string;
  config: QueryEngineConfig;
  transcript: SerializedTranscript;
  usage: SerializedUsage;
  metadata: {
    startedAt: string;
    lastActivityAt: string;
    status: string;
  };
}

export interface SessionStore {
  save(state: SessionState): Promise<void>;
  load(sessionId: string): Promise<SessionState | null>;
  exists(sessionId: string): Promise<boolean>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
}

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionState>();

  return {
    async save(state) {
      sessions.set(state.sessionId, structuredClone(state));
    },

    async load(sessionId) {
      const state = sessions.get(sessionId);
      return state ? structuredClone(state) : null;
    },

    async exists(sessionId) {
      return sessions.has(sessionId);
    },

    async delete(sessionId) {
      sessions.delete(sessionId);
    },

    async list() {
      return Array.from(sessions.keys());
    },
  };
}

export function createPostgresSessionStore({
  getTaskCheckpointData,
  setTaskCheckpointData,
}: {
  getTaskCheckpointData: (
    taskId: string,
  ) => Promise<Record<string, unknown> | null>;
  setTaskCheckpointData: (
    taskId: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
}): SessionStore {
  return {
    async save(state) {
      await setTaskCheckpointData(
        state.sessionId,
        state as unknown as Record<string, unknown>,
      );
    },

    async load(sessionId) {
      const data = await getTaskCheckpointData(sessionId);
      if (!data) return null;
      return data as unknown as SessionState;
    },

    async exists(sessionId) {
      const data = await getTaskCheckpointData(sessionId);
      return data !== null;
    },

    async delete(sessionId) {
      await setTaskCheckpointData(sessionId, {} as Record<string, unknown>);
    },

    async list() {
      return [];
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/session-store.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/session-store.ts tests/unit/harness/session-store.test.ts && git commit -m "feat(harness): add SessionStore with memory and Postgres backends"
```

---

## Task 6: Add compaction event type to events.ts

**Files:**

- Modify: `src/harness/events.ts`
- Modify: `tests/unit/harness/events.test.ts`

### What this does

Adds a `compaction` event type to `HarnessEvent` so QueryEnginePort can signal when transcript compaction occurs. This is needed before the QueryEnginePort integration.

- [ ] **Step 1: Add compaction event type to events.ts**

In `src/harness/events.ts`, add this variant to the `HarnessEvent` union type (after the `checkpoint` variant, before `session_end`):

```typescript
  | {
      type: "compaction"
      messagesBefore: number
      messagesAfter: number
      compactionCount: number
    }
```

And add this helper function at the bottom of the file, after the existing `isCheckpointEvent`:

```typescript
export function isCompactionEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "compaction" } {
  return event.type === "compaction";
}
```

The complete `HarnessEvent` type should look like:

```typescript
export type HarnessEvent =
  | { type: "session_start"; sessionId: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "token_update"; used: number; budget: number; percent: number }
  | { type: "checkpoint"; reason: "token_limit" | "stall" | "manual" }
  | {
      type: "compaction";
      messagesBefore: number;
      messagesAfter: number;
      compactionCount: number;
    }
  | {
      type: "session_end";
      reason:
        | "completed"
        | "checkpoint"
        | "error"
        | "max_iterations"
        | "interrupted";
    };
```

**Important:** Do NOT change the `session_end` reason union — the existing values are correct.

- [ ] **Step 2: Write test for compaction event helper**

Merge this into the existing `tests/unit/harness/events.test.ts`. Add the import `isCompactionEvent` to the existing import statement, then add this `describe` block after the existing tests:

```typescript
// Add isCompactionEvent to the existing import:
// import { ..., isCompactionEvent } from "../../../src/harness/events.js"

describe("compaction event", () => {
  it("isCompactionEvent returns true for compaction events", () => {
    const event = {
      type: "compaction" as const,
      messagesBefore: 20,
      messagesAfter: 6,
      compactionCount: 1,
    };
    expect(isCompactionEvent(event)).toBe(true);
    expect(isCompactionEvent({ type: "text_delta", text: "hi" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/events.test.ts
```

Expected: PASS (existing tests + new compaction test).

- [ ] **Step 4: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS. Adding a new variant to the union type is backwards-compatible — existing code that pattern-matches on `event.type` doesn't need to handle `"compaction"` unless it uses exhaustive switch.

- [ ] **Step 5: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/events.ts tests/unit/harness/events.test.ts && git commit -m "feat(harness): add compaction event type to HarnessEvent"
```

---

## Task 7: QueryEnginePort — the orchestrator (wraps runAgentLoop)

**Files:**

- Create: `src/harness/query-engine-port.ts`
- Test: `tests/unit/harness/query-engine-port.test.ts`

### What this does

This is the centerpiece — mirrors claw-code's `QueryEnginePort` class. It owns TranscriptStore, SessionStore, UsageTracker. It's the single entry point: give it a config + adapter, and it manages everything internally.

**Critical design decision: wrap, don't rewrite.** QueryEnginePort calls `runAgentLoop` as its inner loop. It iterates the events `runAgentLoop` yields, passes them through to the caller, and layers compaction/persistence/usage-tracking on top. The `runAgentLoop` function stays completely unchanged.

The wrapping strategy:

1. QueryEnginePort builds a `TranscriptStore` with system prompt + user prompt
2. It calls `runAgentLoop` passing `transcript.getMessages()` as the message context
3. It iterates the events from `runAgentLoop`, yielding each one through
4. For each event, it updates the TranscriptStore and UsageTracker
5. When `runAgentLoop` yields `session_end(checkpoint)`, QueryEnginePort intercepts it and may run compaction first
6. When `runAgentLoop` yields `session_end(completed)`, QueryEnginePort saves the session

The key subtlety: `runAgentLoop` already handles checkpoint detection (token_update >= 85%). QueryEnginePort adds a pre-checkpoint compaction step at 70%. To do this, it uses a lower `checkpointThresholdPercent` on the first call to `runAgentLoop` (matching the compaction threshold), and when that triggers a checkpoint, QueryEnginePort runs compaction and then calls `runAgentLoop` again with the compacted transcript. If the second call ALSO triggers a checkpoint, that's the real checkpoint — session dies.

- [ ] **Step 1: Write failing tests for QueryEnginePort**

```typescript
import { describe, it, expect } from "vitest";
import { createQueryEnginePort } from "../../../src/harness/query-engine-port.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";
import { createMemorySessionStore } from "../../../src/harness/session-store.js";
import type { HarnessEvent } from "../../../src/harness/events.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";
import { PERMISSION_ACTION } from "../../../src/harness/permissions.js";

async function collectEvents(
  gen: AsyncGenerator<HarnessEvent>,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

describe("QueryEnginePort", () => {
  it("runs a simple text-only session to completion", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "Hello world" }]],
    });
    const config = createQueryEngineConfig({
      sessionId: "sess-1",
      workspacePath: "/tmp/test",
      maxTurns: 10,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Say hello"));
    const endEvent = events.find((e) => e.type === "session_end");
    expect(endEvent).toBeDefined();
    expect((endEvent as { reason: string }).reason).toBe("completed");
  });

  it("runs a session with tool use", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "echo",
            input: { msg: "hi" },
          },
        ],
        [{ type: "text_delta", text: "Done" }],
      ],
    });

    const echoTool: ToolHandler = {
      name: "echo",
      description: "Echo",
      inputSchema: {},
      execute: async (input) => ({
        output: JSON.stringify(input),
        isError: false,
      }),
    };

    const config = createQueryEngineConfig({
      sessionId: "sess-2",
      workspacePath: "/tmp/test",
      maxTurns: 10,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({
      config,
      adapter,
      sessionStore,
      toolHandlers: new Map([["echo", echoTool]]),
      permissionRules: [{ tool: "echo", action: PERMISSION_ACTION.allow }],
    });

    const events = await collectEvents(port.run("Use echo"));

    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });

  it("triggers compaction when inner loop checkpoints at compaction threshold, then continues", async () => {
    // Strategy: QEP calls runAgentLoop with checkpointThresholdPercent = compactionThreshold (70).
    // When that triggers, QEP compacts and calls runAgentLoop again with the compacted transcript.
    // The second call completes normally (below threshold).
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // First runAgentLoop call: work + 72% token usage → triggers checkpoint at 70%
        [
          { type: "text_delta", text: "Working..." },
          { type: "token_update", used: 92_160, budget: 128_000, percent: 72 },
        ],
        // runAgentLoop summary turn (triggered by checkpoint logic in agent-loop.ts)
        [{ type: "text_delta", text: "Summary: did step 1." }],
        // Compaction call (TranscriptStore.compact calls adapter.chat)
        [{ type: "text_delta", text: "Compacted summary of conversation." }],
        // Second runAgentLoop call (after compaction): completes normally
        [
          { type: "text_delta", text: "Continuing after compaction." },
          { type: "token_update", used: 30_000, budget: 128_000, percent: 23 },
        ],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "compact-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
      compactionPreserveMessages: 2,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Do a big task"));

    const compactionEvents = events.filter((e) => e.type === "compaction");
    expect(compactionEvents.length).toBe(1);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });

  it("checkpoints (session dies) when post-compaction runAgentLoop also exceeds threshold", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // First runAgentLoop: 88% → triggers checkpoint at compaction threshold
        [
          { type: "text_delta", text: "Work..." },
          { type: "token_update", used: 112_640, budget: 128_000, percent: 88 },
        ],
        // Summary turn from first runAgentLoop checkpoint
        [{ type: "text_delta", text: "Summary of work." }],
        // Compaction call
        [{ type: "text_delta", text: "Compacted." }],
        // Second runAgentLoop (after compaction): STILL high → triggers real checkpoint
        [
          { type: "text_delta", text: "Still too much context." },
          { type: "token_update", used: 110_000, budget: 128_000, percent: 86 },
        ],
        // Summary from second checkpoint
        [{ type: "text_delta", text: "Final summary for resume." }],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "cp-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
      compactionPreserveMessages: 1,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Huge task"));

    expect(events.some((e) => e.type === "compaction")).toBe(true);
    expect(events.some((e) => e.type === "checkpoint")).toBe(true);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "checkpoint" });
  });

  it("saves session state on checkpoint", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // First runAgentLoop: very high → compaction threshold
        [
          { type: "text_delta", text: "Work..." },
          { type: "token_update", used: 115_000, budget: 128_000, percent: 90 },
        ],
        [{ type: "text_delta", text: "Summary." }],
        // Compaction
        [{ type: "text_delta", text: "Compacted." }],
        // Second runAgentLoop: still high → real checkpoint
        [
          { type: "text_delta", text: "Still high." },
          { type: "token_update", used: 112_000, budget: 128_000, percent: 87 },
        ],
        [{ type: "text_delta", text: "Session summary for resume." }],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "save-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    await collectEvents(port.run("Work"));

    const saved = await sessionStore.load("save-test");
    expect(saved).not.toBeNull();
    expect(saved?.sessionId).toBe("save-test");
    expect(saved?.metadata.status).toBe("checkpointed");
  });

  it("resumes from saved session state", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "Resumed and completed." }]],
    });

    const sessionStore = createMemorySessionStore();
    await sessionStore.save({
      sessionId: "resume-test",
      config: createQueryEngineConfig({
        sessionId: "resume-test",
        workspacePath: "/tmp",
      }),
      transcript: {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "original task" },
          { role: "assistant", content: "I was working on..." },
        ],
        compactionCount: 0,
        isFlushed: false,
      },
      usage: {
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        turnCount: 2,
        toolCallCount: 1,
        permissionDenialCount: 0,
        currentPercent: 30,
      },
      metadata: {
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: "checkpointed",
      },
    });

    const config = createQueryEngineConfig({
      sessionId: "resume-test",
      workspacePath: "/tmp",
      maxTurns: 10,
    });
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.resume("resume-test"));
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/query-engine-port.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement QueryEnginePort**

The key insight: QueryEnginePort uses `runAgentLoop` with `checkpointThresholdPercent` set to the **compaction** threshold (70%). When `runAgentLoop` emits `session_end(checkpoint)`, QueryEnginePort intercepts it, runs compaction, and then calls `runAgentLoop` again with the compacted transcript and the **real** checkpoint threshold (85%). If the second call also emits `session_end(checkpoint)`, that's the real checkpoint — session dies.

```typescript
// src/harness/query-engine-port.ts

import type { ToolResult } from "../types.js";
import type { HarnessEvent } from "./events.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import type { ToolHandler } from "./tools/tool-types.js";
import type { PermissionRule } from "./permissions.js";
import { DEFAULT_PERMISSION_RULES } from "./permissions.js";
import {
  createTranscriptStore,
  type TranscriptStore,
} from "./transcript-store.js";
import { createUsageTracker, type UsageTracker } from "./usage-tracker.js";
import {
  createMemorySessionStore,
  type SessionStore,
  type SessionState,
} from "./session-store.js";
import { runAgentLoop } from "./agent-loop.js";

export interface QueryEnginePortOptions {
  config: QueryEngineConfig;
  adapter: ModelAdapter;
  sessionStore?: SessionStore;
  toolHandlers?: Map<string, ToolHandler>;
  permissionRules?: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}

export interface QueryEnginePort {
  config: QueryEngineConfig;
  run(userPrompt: string): AsyncGenerator<HarnessEvent>;
  resume(sessionId: string): AsyncGenerator<HarnessEvent>;
}

export function createQueryEnginePort({
  config,
  adapter,
  sessionStore = createMemorySessionStore(),
  toolHandlers,
  permissionRules = DEFAULT_PERMISSION_RULES,
  mcpCallTool,
}: QueryEnginePortOptions): QueryEnginePort {
  async function* run(userPrompt: string): AsyncGenerator<HarnessEvent> {
    const transcript = createTranscriptStore({
      systemPrompt: buildSystemPromptPlaceholder(),
      userPrompt,
    });
    const usage = createUsageTracker();

    yield* orchestrate({
      transcript,
      usage,
      config,
      adapter,
      sessionStore,
      toolHandlers,
      permissionRules,
      mcpCallTool,
    });
  }

  async function* resume(sessionId: string): AsyncGenerator<HarnessEvent> {
    const saved = await sessionStore.load(sessionId);
    if (!saved) {
      yield { type: "session_end", reason: "error" };
      return;
    }

    const transcript = createTranscriptStore({
      systemPrompt:
        saved.transcript.messages.find((m) => m.role === "system")?.content ??
        "",
      userPrompt:
        saved.transcript.messages.find((m) => m.role === "user")?.content ?? "",
      fromSerialized: saved.transcript,
    });
    const usage = createUsageTracker({ fromSerialized: saved.usage });

    yield* orchestrate({
      transcript,
      usage,
      config,
      adapter,
      sessionStore,
      toolHandlers,
      permissionRules,
      mcpCallTool,
    });
  }

  return { config, run, resume };
}

function buildSystemPromptPlaceholder(): string {
  return [
    "IDENTITY",
    "You are a coding agent.",
    "Follow instructions precisely and stay deterministic.",
  ].join("\n");
}

async function* orchestrate({
  transcript,
  usage,
  config,
  adapter,
  sessionStore,
  toolHandlers,
  permissionRules,
  mcpCallTool,
}: {
  transcript: TranscriptStore;
  usage: UsageTracker;
  config: QueryEngineConfig;
  adapter: ModelAdapter;
  sessionStore: SessionStore;
  toolHandlers?: Map<string, ToolHandler>;
  permissionRules: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}): AsyncGenerator<HarnessEvent> {
  const messages = transcript.getMessages();
  const systemPrompt = messages[0]?.content ?? "";
  const userPrompt = messages.find((m) => m.role === "user")?.content ?? "";

  const compactionThresholdPercent = config.compactionEnabled
    ? Math.round(config.compactionThreshold * 100)
    : Math.round(config.checkpointThreshold * 100);

  const innerEvents: HarnessEvent[] = [];
  let endReason = "unknown";

  for await (const event of runAgentLoop({
    adapter,
    systemPrompt,
    userPrompt,
    tools: [],
    maxIterations: config.maxTurns,
    tokenBudget: config.maxTokens,
    workspacePath: config.workspacePath,
    toolHandlers,
    sessionId: config.sessionId,
    checkpointThresholdPercent: compactionThresholdPercent,
    permissionRules,
    mcpCallTool,
  })) {
    if (event.type === "tool_use") {
      usage.addToolCall();
    }
    if (event.type === "permission_denied") {
      usage.addPermissionDenial();
    }
    if (event.type === "token_update") {
      usage.updateTokenPercent(event.percent);
    }
    if (event.type === "text_delta") {
      innerEvents.push(event);
    }
    if (event.type === "tool_result") {
      transcript.addToolResult({
        toolUseId: event.id,
        toolName: "",
        output: event.output,
      });
    }

    if (event.type === "session_end") {
      endReason = event.reason;
      if (
        event.reason === "checkpoint" &&
        config.compactionEnabled &&
        transcript.shouldCompact({
          config,
          currentTokenPercent: usage.currentPercent,
        })
      ) {
        yield event;
        break;
      }
    }

    yield event;
  }

  for (const event of innerEvents) {
    if (event.type === "text_delta") {
      transcript.addAssistantMessage(event.text);
    }
  }

  usage.addTurn({ inputTokens: 0, outputTokens: 0 });

  if (endReason === "checkpoint" && config.compactionEnabled) {
    const messagesBefore = transcript.getMessages().length;
    await transcript.compact({ config, adapter });
    const messagesAfter = transcript.getMessages().length;

    yield {
      type: "compaction",
      messagesBefore,
      messagesAfter,
      compactionCount: transcript.compactionCount,
    };

    const postCompactMessages = transcript.getMessages();
    const resumeSystemPrompt = postCompactMessages[0]?.content ?? systemPrompt;
    const resumeUserPrompt =
      postCompactMessages.find((m) => m.role === "user")?.content ?? userPrompt;

    for await (const event of runAgentLoop({
      adapter,
      systemPrompt: resumeSystemPrompt,
      userPrompt: resumeUserPrompt,
      tools: [],
      maxIterations: config.maxTurns,
      tokenBudget: config.maxTokens,
      workspacePath: config.workspacePath,
      toolHandlers,
      sessionId: config.sessionId,
      checkpointThresholdPercent: Math.round(config.checkpointThreshold * 100),
      permissionRules,
      mcpCallTool,
    })) {
      if (event.type === "tool_use") usage.addToolCall();
      if (event.type === "permission_denied") usage.addPermissionDenial();
      if (event.type === "token_update") {
        usage.updateTokenPercent(event.percent);
      }

      yield event;

      if (event.type === "session_end") {
        if (event.reason === "checkpoint") {
          await sessionStore.save(
            buildSessionState({
              config,
              transcript,
              usage,
              status: "checkpointed",
            }),
          );
        } else {
          await sessionStore.save(
            buildSessionState({
              config,
              transcript,
              usage,
              status: event.reason,
            }),
          );
        }
        return;
      }
    }
    return;
  }

  if (endReason !== "unknown") {
    await sessionStore.save(
      buildSessionState({ config, transcript, usage, status: endReason }),
    );
  }
}

function buildSessionState({
  config,
  transcript,
  usage,
  status,
}: {
  config: QueryEngineConfig;
  transcript: TranscriptStore;
  usage: UsageTracker;
  status: string;
}): SessionState {
  return {
    sessionId: config.sessionId,
    config,
    transcript: transcript.toSerializable(),
    usage: usage.toSerializable(),
    metadata: {
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status,
    },
  };
}
```

**Design notes for implementer:**

- The `orchestrate` function calls `runAgentLoop` with `checkpointThresholdPercent` set to the compaction threshold (70%). This means `runAgentLoop`'s existing checkpoint logic fires at 70% instead of 85%.
- When `runAgentLoop` yields `session_end(checkpoint)`, `orchestrate` intercepts it, runs transcript compaction, and calls `runAgentLoop` **again** with the compacted transcript and the real checkpoint threshold (85%).
- This "two-pass" approach means `runAgentLoop` is called 1-2 times per orchestrated session. The first call may trigger compaction; the second call runs with the real threshold.
- The `session_end` event from the first `runAgentLoop` is yielded to the caller (so they see the flow), but it's not the final end — the compaction + second pass follow.
- If the second `runAgentLoop` also triggers checkpoint, that's the real checkpoint and the session ends.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/unit/harness/query-engine-port.test.ts
```

Expected: all 6 tests PASS.

**If tests fail:** The mock adapter call count must match the number of `adapter.chat()` calls. Trace through each test scenario carefully:

- Simple text: 1 call from `runAgentLoop`
- Tool use: 2 calls from `runAgentLoop` (one per iteration)
- Compaction: `runAgentLoop` call 1 (work turn) + `runAgentLoop` call 2 (summary turn) = 2 calls, then `transcript.compact` = 1 call, then second `runAgentLoop` call (work turn) = 1 call → total 4 calls
- Checkpoint after compaction: same as above but second `runAgentLoop` also triggers checkpoint → 6 calls total

Adjust mock adapter `responses` arrays if counts don't match.

- [ ] **Step 5: Run all existing tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all existing tests still PASS. `runAgentLoop` is unchanged; its direct tests still work. QueryEnginePort is additive.

- [ ] **Step 6: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/harness/query-engine-port.ts tests/unit/harness/query-engine-port.test.ts && git commit -m "feat(harness): add QueryEnginePort orchestrator wrapping runAgentLoop"
```

---

## Task 8: Rewire session-manager.ts to use QueryEnginePort

**Files:**

- Modify: `src/core/session-manager.ts`
- Modify: `tests/integration/session-manager.test.ts`

### What this does

Rewrites `runSingleSession` to use `QueryEnginePort` instead of directly calling `runAgentLoop`. This is the integration point — after this task, the full stack (config → transcript → compaction → checkpoint → session persistence) works end-to-end.

The existing function signature stays the same (`{ events, endReason }`) so callers (scheduler, CLI) don't need changes. The `resumeCheckpoint` parameter behavior is preserved: checkpoint summary is appended to the system prompt, just as in the original implementation.

- [ ] **Step 1: Write additional test for updated session-manager**

Add this test to the existing `tests/integration/session-manager.test.ts` describe block, after the existing test:

```typescript
it("uses QueryEnginePort for session orchestration", async () => {
  const baseDir = join(
    tmpdir(),
    `claw-engine-qep-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const repoPath = join(baseDir, "repo");

  await mkdir(baseDir, { recursive: true });
  await initCommittedRepo(repoPath);

  try {
    const adapter = createMockAdapter({
      name: "mock-qep",
      responses: [[{ type: "text_delta", text: "completed via QEP" }]],
    });

    const result = await runSingleSession({
      adapter,
      systemPrompt: "You are a test runner.",
      userPrompt: "Say hello.",
      tools: [],
      workspacePath: repoPath,
      maxIterations: 3,
    });

    expect(result.endReason).toBe("completed");
    expect(result.events.some((e) => e.type === "session_end")).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rewrite session-manager.ts to use QueryEnginePort**

Replace the content of `src/core/session-manager.ts` with:

```typescript
import type { Message, ToolDefinition, ToolResult } from "../types.js";
import type { HarnessEvent } from "../harness/events.js";
import type { ModelAdapter } from "../harness/model-adapters/adapter-types.js";
import type { ToolHandler } from "../harness/tools/tool-types.js";
import type { PermissionRule } from "../harness/permissions.js";
import { createQueryEngineConfig } from "../harness/query-engine-config.js";
import { createQueryEnginePort } from "../harness/query-engine-port.js";
import { createMemorySessionStore } from "../harness/session-store.js";

export interface ResumeCheckpoint {
  summary: string;
  recentMessages?: Message[];
}

export async function runSingleSession({
  adapter,
  systemPrompt,
  userPrompt,
  tools,
  workspacePath,
  maxIterations,
  toolHandlers,
  resumeCheckpoint,
  checkpointThresholdPercent,
  sessionId,
  permissionRules,
  mcpCallTool,
}: {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  workspacePath: string;
  maxIterations: number;
  toolHandlers?: Map<string, ToolHandler>;
  resumeCheckpoint?: ResumeCheckpoint;
  checkpointThresholdPercent?: number;
  sessionId?: string;
  permissionRules?: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}): Promise<{ events: HarnessEvent[]; endReason: string }> {
  const config = createQueryEngineConfig({
    maxTurns: maxIterations,
    workspacePath,
    sessionId: sessionId ?? `session-${Date.now()}`,
    checkpointThreshold: checkpointThresholdPercent
      ? checkpointThresholdPercent / 100
      : undefined,
    maxTokens: adapter.maxContext,
  });

  const sessionStore = createMemorySessionStore();
  const port = createQueryEnginePort({
    config,
    adapter,
    sessionStore,
    toolHandlers,
    permissionRules,
    mcpCallTool,
  });

  const events: HarnessEvent[] = [];
  let endReason = "unknown";

  const effectivePrompt = resumeCheckpoint
    ? `${userPrompt}\n\n---\nCHECKPOINT\n${JSON.stringify({ summary: resumeCheckpoint.summary, recentMessages: resumeCheckpoint.recentMessages ?? [] }, null, 2)}`
    : userPrompt;

  for await (const event of port.run(effectivePrompt)) {
    events.push(event);
    if (event.type === "session_end") {
      endReason = event.reason;
    }
  }

  return { events, endReason };
}
```

**Backwards compatibility notes:**

- The function signature is unchanged for existing callers (new optional params `sessionId`, `permissionRules`, `mcpCallTool` don't affect existing call sites)
- `resumeCheckpoint` is appended to `userPrompt` instead of `systemPrompt` — this is a minor behavioral change, but the checkpoint data still reaches the model. The original appended it to `systemPrompt` which is also fine. If exact backwards-compat is needed, the implementer can adjust.
- `tokenBudget: 128_000` is replaced by `adapter.maxContext` which defaults to `128000` for the mock adapter, so no behavioral change in tests.

- [ ] **Step 3: Run session-manager integration tests**

```bash
cd ~/server/apps/claw-engine && npx vitest run tests/integration/session-manager.test.ts
```

Expected: both tests PASS.

- [ ] **Step 4: Run ALL tests to verify nothing broke**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all tests PASS. The agent-loop tests still pass because `runAgentLoop` is unchanged. The checkpoint tests call `runAgentLoop` directly and still work.

- [ ] **Step 5: Commit**

```bash
cd ~/server/apps/claw-engine && git add src/core/session-manager.ts tests/integration/session-manager.test.ts && git commit -m "refactor(core): rewire session-manager to use QueryEnginePort orchestrator"
```

---

## Task 9: Verify full test suite and type-check

**Files:**

- No new files — this is a verification task

- [ ] **Step 1: Run all unit tests**

```bash
cd ~/server/apps/claw-engine && npm test
```

Expected: all tests PASS (original 110+ plus ~45 new tests).

- [ ] **Step 2: Run TypeScript type checker**

```bash
cd ~/server/apps/claw-engine && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Run integration tests (if DB/Redis available)**

```bash
cd ~/server/apps/claw-engine && npm run test:integration
```

Expected: all integration tests PASS.

- [ ] **Step 4: Commit any fixes needed**

If any tests or type-check fail, fix and commit:

```bash
cd ~/server/apps/claw-engine && git add -A && git commit -m "fix: resolve type/test issues from claw-code alignment refactoring"
```

---

## What was NOT changed (by design)

| Component                                | Reason                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `runAgentLoop` in `agent-loop.ts`        | Stays as-is. QueryEnginePort calls it as the inner loop. Existing tests keep passing. |
| 7 built-in tools (bash, read_file, etc.) | They work. ToolPool wraps them, doesn't modify them.                                  |
| Router, Scheduler, DAG decomposer        | Above the harness layer. They call session-manager, which now uses QEP internally.    |
| CLI commands                             | They call session-manager or scheduler. No interface change.                          |
| API routes + SSE                         | They consume events. HarnessEvent gained `compaction` type (additive).                |
| Dashboard                                | Reads SSE events. Can display compaction events when UI is updated (future).          |
| DB schema                                | SessionStore uses existing `checkpoint_data` JSONB column. No migration needed.       |
| MCP integration                          | Plugs into QueryEnginePort via `mcpCallTool` callback. No change.                     |

## Architecture after this sprint

```
┌─────────────────────────────────────────────────────┐
│  CLI / API / Scheduler                               │
│    ↓                                                 │
│  runSingleSession()  (session-manager.ts)            │
│    ↓                                                 │
│  QueryEnginePort  (query-engine-port.ts)             │
│    ├─ QueryEngineConfig  (query-engine-config.ts)    │
│    ├─ TranscriptStore    (transcript-store.ts)        │
│    │   └─ auto-compaction at 70% via adapter.chat()  │
│    ├─ UsageTracker       (usage-tracker.ts)           │
│    ├─ SessionStore       (session-store.ts)           │
│    │   └─ memory or Postgres backend                  │
│    ├─ ToolPool           (tool-pool.ts)               │
│    │   └─ profile-based (full/simple/readonly/custom) │
│    └─ runAgentLoop()     (agent-loop.ts — UNCHANGED)  │
│        ├─ ModelAdapter   (alibaba/claude-pipe/mock)    │
│        ├─ Permissions    (permissions.ts)              │
│        └─ Tool execution (builtins + MCP)              │
└─────────────────────────────────────────────────────┘
```

## How compaction works (the two-pass strategy)

```
QueryEnginePort.orchestrate():
  │
  ├─ Pass 1: runAgentLoop(checkpointThresholdPercent = 70%)
  │    ├─ Model works, uses tools, generates text
  │    ├─ token_update reaches 72% → triggers checkpoint at 70%
  │    ├─ agent-loop injects summary prompt, gets summary
  │    └─ yields session_end(checkpoint)
  │
  ├─ QEP intercepts: "checkpoint at compaction threshold, not real checkpoint"
  │    ├─ Runs transcript.compact(adapter) → summarizes old messages
  │    ├─ yields compaction event
  │    └─ Continues to Pass 2
  │
  ├─ Pass 2: runAgentLoop(checkpointThresholdPercent = 85%)
  │    ├─ Model continues with compacted transcript
  │    ├─ If tokens stay below 85% → completes normally
  │    └─ If tokens hit 85% → real checkpoint, session dies
  │
  └─ Saves session state via SessionStore
```

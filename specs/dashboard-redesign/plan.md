# Dashboard Redesign — Implementation Plan

**Goal:** Replace the 5-page dashboard with a single-view passive monitor: task list (left) + live stream (right) + KPI header.
**Architecture:** Full rewrite of `src/dashboard/src/`. Keep lib/sse.ts, lib/sse-context.tsx, lib/api.ts (with modifications), lib/pipeline.ts, lib/toast.ts. Replace all pages with a single App component. Remove react-router-dom, @xyflow/react, recharts.
**Tech Stack:** React 19, Vite, Tailwind CSS v4, @tanstack/react-virtual (stream virtualization)
**Spec:** specs/dashboard-redesign/spec.md
**Plan:** specs/dashboard-redesign/plan.md

**REQUIRED SUB-SKILL:** nexus:subagent-driven-development (recommended for parallel execution)

---

## File Map

### Delete (entire pages + layout)

- `src/dashboard/src/pages/pipeline.tsx`
- `src/dashboard/src/pages/dag.tsx`
- `src/dashboard/src/pages/sessions.tsx`
- `src/dashboard/src/pages/metrics.tsx`
- `src/dashboard/src/pages/logs.tsx`
- `src/dashboard/src/components/layout.tsx`
- `src/dashboard/src/components/phase-timeline.tsx` (will rebuild inline)

### Keep (reuse as-is or with minor edits)

- `src/dashboard/src/lib/sse.ts` — SSE client (no changes)
- `src/dashboard/src/lib/sse-context.tsx` — SSE provider (no changes)
- `src/dashboard/src/lib/toast.ts` — toast state (no changes)
- `src/dashboard/src/lib/pipeline.ts` — phase parsing helpers (no changes)
- `src/dashboard/src/lib/api.ts` — keep fetchers, add new types
- `src/dashboard/src/components/toast-container.tsx` — keep (no changes)
- `src/dashboard/src/main.tsx` — minor edit (remove router)

### Create (new files)

- `src/dashboard/src/App.tsx` — single-view shell (header + split layout)
- `src/dashboard/src/components/header.tsx` — logo + KPI chips + connection indicator
- `src/dashboard/src/components/task-list.tsx` — left pane, scrollable task items
- `src/dashboard/src/components/task-item.tsx` — single task row in list
- `src/dashboard/src/components/stream-pane.tsx` — right pane, live event stream
- `src/dashboard/src/components/stream-event.tsx` — single event renderer (by type)
- `src/dashboard/src/components/phase-bar.tsx` — horizontal pipeline phase indicator
- `src/dashboard/src/components/connection-indicator.tsx` — LIVE / DISCONNECTED dot
- `src/dashboard/src/hooks/use-tasks.ts` — fetch tasks + SSE updates + selection state
- `src/dashboard/src/hooks/use-stream.ts` — SSE stream for selected task + historical fallback
- `src/dashboard/src/hooks/use-kpis.ts` — compute KPI values from tasks + SSE
- `src/dashboard/src/index.css` — updated theme (simplified, remove unused animations)

### Modify (package.json)

- Remove: `react-router-dom`, `@xyflow/react`, `recharts`
- Add: `@tanstack/react-virtual`

---

## Task Breakdown

### Task 1: Clean slate — remove old pages and dependencies

**Files:**

- Delete: `src/dashboard/src/pages/` (all 5 files)
- Delete: `src/dashboard/src/components/layout.tsx`
- Delete: `src/dashboard/src/components/phase-timeline.tsx`
- Delete: `src/dashboard/src/components/ui/` (all files — rebuilding inline)
- Modify: `src/dashboard/package.json` — remove react-router-dom, @xyflow/react, recharts; add @tanstack/react-virtual
- Modify: `src/dashboard/src/main.tsx` — remove BrowserRouter wrapper
- Modify: `src/dashboard/src/App.tsx` — replace with placeholder div

**Steps:**

- [ ] Step 1: Delete all page files and old components
- [ ] Step 2: Update package.json — remove `react-router-dom`, `@xyflow/react`, `recharts`; add `@tanstack/react-virtual`
- [ ] Step 3: Run `npm install` in `src/dashboard/`
- [ ] Step 4: Rewrite `main.tsx` — remove Router import, render `<SseProvider><App /><ToastContainer /></SseProvider>`
- [ ] Step 5: Rewrite `App.tsx` — placeholder: `<div className="h-screen bg-[#0a0a0b] text-white">Dashboard v2</div>`
- [ ] Step 6: Run `npm run build` in `src/dashboard/` — verify it compiles with zero errors
- [ ] Step 7: Commit: `refactor: strip old dashboard pages for redesign`

---

### Task 2: Theme — update index.css for new design system

**Files:**

- Modify: `src/dashboard/src/index.css`

**Steps:**

- [ ] Step 1: Replace the @theme block with simplified token set:
      `css
    @theme {
      --color-bg: #0a0a0b;
      --color-surface: #111113;
      --color-surface-2: #1a1a1d;
      --color-border: rgba(255, 255, 255, 0.06);
      --color-border-active: rgba(255, 255, 255, 0.12);
      --color-text-primary: rgba(255, 255, 255, 0.9);
      --color-text-secondary: rgba(255, 255, 255, 0.6);
      --color-text-tertiary: rgba(255, 255, 255, 0.4);
      --color-accent: #2dd4bf;
      --color-status-running: #f59e0b;
      --color-status-completed: #22c55e;
      --color-status-failed: #ef4444;
      --color-status-pending: rgba(255, 255, 255, 0.3);
      --color-stream-tool: #2dd4bf;
      --color-stream-text: rgba(255, 255, 255, 0.9);
      --color-stream-token: #f59e0b;
      --color-stream-routing: rgba(255, 255, 255, 0.4);
      --font-sans: 'Inter', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'Geist Mono', monospace;
    }
    `
- [ ] Step 2: Keep only these animations: `fade-in`, `status-pulse`, `toast-in`, `toast-out`. Remove all others.
- [ ] Step 3: Add scrollbar styling for dark theme (thin, subtle)
- [ ] Step 4: Remove ReactFlow overrides, glass utility, unused utilities
- [ ] Step 5: Run `npm run build` — verify compiles
- [ ] Step 6: Commit: `style: simplified design tokens for dashboard v2`

---

### Task 3: Header component with KPI chips

**Files:**

- Create: `src/dashboard/src/components/header.tsx`
- Create: `src/dashboard/src/components/connection-indicator.tsx`
- Create: `src/dashboard/src/hooks/use-kpis.ts`

**Steps:**

- [ ] Step 1: Create `connection-indicator.tsx`: - Props: `{ connected: boolean }` - Render: green dot + "LIVE" or red dot + "DISCONNECTED" - Green dot has pulse animation when connected - Tailwind only, no external deps

- [ ] Step 2: Create `use-kpis.ts` hook: - Input: `tasks: Task[]` (from parent) - Computes: `{ running: number, completedToday: number, failedToday: number, tokensToday: number, costToday: number }` - "Today" = tasks where startedAt is same calendar day - Format helpers: `formatTokens(n)` → "12.4K", `formatCost(n)` → "$0.08" - Returns KPI object + format functions

- [ ] Step 3: Create `header.tsx`: - Full-width bar, `h-14`, bg-surface, border-b border-border - Left: Claw Engine logo (bolt icon + text), version badge - Right: KPI chips row + ConnectionIndicator - KPI chip: `<span className="text-text-tertiary text-xs">label</span> <span className="text-text-primary font-mono text-sm">value</span>` - Chips: "● N running" (green if >0), "today N✓ N✗", "tokens 12.4K", "cost $0.08" - Props: `{ kpis: KpiData, connected: boolean }`

- [ ] Step 4: Run `npm run build` — verify compiles
- [ ] Step 5: Commit: `feat: header component with KPI chips and connection indicator`

---

### Task 4: Task list component (left pane)

**Files:**

- Create: `src/dashboard/src/components/task-item.tsx`
- Create: `src/dashboard/src/components/task-list.tsx`
- Create: `src/dashboard/src/hooks/use-tasks.ts`

**Steps:**

- [ ] Step 1: Create `use-tasks.ts` hook: - On mount: fetch `GET /api/v1/tasks?limit=50` - Subscribe to global SSE: on `session_start` → refetch, on `session_end` → refetch - State: `tasks: Task[]`, `selectedId: string | null`, `setSelectedId(id)` - Auto-select: if nothing selected, select first running task; if none running, select most recent - Sort: running tasks first (by startedAt desc), then completed/failed (by completedAt desc) - Returns `{ tasks, selectedId, setSelectedId, selectedTask }`

- [ ] Step 2: Create `task-item.tsx`: - Props: `{ task: Task, selected: boolean, onClick: () => void }` - Layout: single row, `px-3 py-2.5`, cursor-pointer - Left: status dot (8px circle, color by status, pulse animation if running) - Middle: title (truncated, `text-sm text-text-primary`), time ago (`text-xs text-text-tertiary`) - Right: model badge (`text-xs font-mono text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded`) - Selected state: `bg-surface-2 border-l-2 border-accent` - Hover state: `bg-surface-2/50`

- [ ] Step 3: Create `task-list.tsx`: - Props: `{ tasks: Task[], selectedId: string | null, onSelect: (id: string) => void }` - Layout: `w-80 h-full overflow-y-auto border-r border-border bg-surface` - Header inside: "Tasks" label + count badge - Maps tasks to TaskItem components - Empty state if no tasks

- [ ] Step 4: Run `npm run build` — verify compiles
- [ ] Step 5: Commit: `feat: task list component with selection and SSE updates`

---

### Task 5: Stream event renderer

**Files:**

- Create: `src/dashboard/src/components/stream-event.tsx`

**Steps:**

- [ ] Step 1: Create `stream-event.tsx`: - Props: `{ event: StreamEvent, now: number }` where StreamEvent = `{ type, timestamp, data }` - Layout: single row, `flex items-start gap-3 px-4 py-1` - Left column: relative timestamp (`text-xs font-mono text-text-tertiary w-12 shrink-0`, e.g. "2s", "1m") - Right column: content (varies by type) - **tool_use**: `[tool]` badge in cyan + `name(input_preview)` in mono, input truncated to 80 chars - **text_delta**: text content, `text-sm text-stream-text`, proportional font. Batch consecutive deltas into single block. - **token_update**: only render if percent changed by >=5 since last shown. Compact: `tokens 45% (12.3K / 200K)` in amber, mono - **session_end**: full-width banner. Green bg for completed, red for failed, yellow for interrupted. Includes reason text. - **routing_decision**: subtle line: `routed → provider (reason)` in text-tertiary, small text - **heartbeat**: return null (never render) - **phase_start**: `▶ PHASE_NAME started` in phase color - **phase_end**: `✓ PHASE_NAME completed (1.2s)` or `✗ PHASE_NAME failed` in phase color

- [ ] Step 2: Run `npm run build` — verify compiles
- [ ] Step 3: Commit: `feat: stream event renderer with semantic formatting`

---

### Task 6: Stream pane with SSE + historical fallback

**Files:**

- Create: `src/dashboard/src/hooks/use-stream.ts`
- Create: `src/dashboard/src/components/stream-pane.tsx`

**Steps:**

- [ ] Step 1: Create `use-stream.ts` hook: - Input: `taskId: string | null`, `taskStatus: string` - If taskStatus is "running": connect to `GET /api/v1/tasks/:id/stream` (SSE), accumulate events in state - If taskStatus is completed/failed: fetch `GET /api/v1/tasks/:id` and extract telemetry as events - On taskId change: clear events, reconnect/refetch - Normalize both SSE events and telemetry entries to a common `StreamEvent` shape: `{ id, type, timestamp, data }` - Returns `{ events: StreamEvent[], isLive: boolean }`

- [ ] Step 2: Create `stream-pane.tsx`: - Props: `{ task: Task | null, events: StreamEvent[], isLive: boolean }` - Layout: `flex-1 h-full flex flex-col bg-bg` - Top bar: task title + status badge + duration + "LIVE" indicator if streaming - If task is pipeline run (check via `isPipelineRun` from lib/pipeline.ts): render PhaseBar above stream - Stream area: `flex-1 overflow-y-auto` with auto-scroll behavior - Auto-scroll: scroll to bottom on new events. Pause when user scrolls up. Resume when user scrolls to bottom (within 50px threshold). - Maps events to StreamEvent components - Empty state if no task selected: "Select a task to view its output" - Use `@tanstack/react-virtual` if events.length > 500 for performance

- [ ] Step 3: Run `npm run build` — verify compiles
- [ ] Step 4: Commit: `feat: stream pane with live SSE and historical fallback`

---

### Task 7: Phase bar for pipeline runs

**Files:**

- Create: `src/dashboard/src/components/phase-bar.tsx`

**Steps:**

- [ ] Step 1: Create `phase-bar.tsx`: - Props: `{ events: StreamEvent[] }` - Uses `extractPhaseEvents()` and `getPhaseStatus()` from `lib/pipeline.ts` - Layout: `h-12 flex items-center gap-1 px-4 border-b border-border bg-surface` - For each phase in PHASE_ORDER: render node + connector line - Node: 24px circle with icon inside. States: - completed: green check (✓) - running: amber spinner (animated) - failed: red X (✗) - pending: gray circle (○) - Label below node: phase name in `text-xs` - Connector: horizontal line between nodes, colored if completed, gray if pending - Attempt badge: if retryCount > 0, show `×N` next to execute phase

- [ ] Step 2: Run `npm run build` — verify compiles
- [ ] Step 3: Commit: `feat: pipeline phase bar component`

---

### Task 8: Wire everything — App.tsx shell

**Files:**

- Modify: `src/dashboard/src/App.tsx`

**Steps:**

- [ ] Step 1: Rewrite `App.tsx` to compose all components:
      `     <div className="h-screen flex flex-col bg-bg text-text-primary overflow-hidden">
      <Header kpis={kpis} connected={connected} />
      <div className="flex-1 flex overflow-hidden">
        <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
        <StreamPane task={selectedTask} events={events} isLive={isLive} />
      </div>
    </div>
    ` - Use `useTasks()` for task list + selection - Use `useKpis(tasks)` for header KPIs - Use `useStream(selectedId, selectedTask?.status)` for stream events - Track SSE connected state from sse-context

- [ ] Step 2: Run `npm run build` — verify compiles with zero errors
- [ ] Step 3: Open http://192.168.1.100:3004 — verify layout renders (header + list + stream)
- [ ] Step 4: Commit: `feat: wire dashboard v2 single-view layout`

---

### Task 9: Polish and verify

**Files:**

- Various minor tweaks across components

**Steps:**

- [ ] Step 1: Take Playwright screenshots of the new dashboard (same viewport 1440x900)
- [ ] Step 2: Verify all spec requirements: - FR-001 through FR-006 (layout) - FR-010 through FR-017 (task list) - FR-020 through FR-024 (stream pane) - FR-030 through FR-033 (phase bar) - FR-040 through FR-042 (KPIs) - FR-050 through FR-053 (connection)
- [ ] Step 3: Fix any visual issues (spacing, colors, text hierarchy)
- [ ] Step 4: Test with a live `claw run` — verify SSE stream renders correctly
- [ ] Step 5: Run `npm run build` for production — verify clean build
- [ ] Step 6: Commit: `feat: dashboard v2 — single-view monitor with live streaming`

---

## Dependency Graph

```
Task 1 (clean slate)
  └→ Task 2 (theme)
       ├→ Task 3 (header) ──────────────┐
       ├→ Task 4 (task list) ────────────┤
       ├→ Task 5 (stream event) ─────────┤
       ├→ Task 6 (stream pane) ← Task 5  ├→ Task 8 (wire) → Task 9 (polish)
       └→ Task 7 (phase bar) ────────────┘
```

Tasks 3, 4, 5, 7 can run in parallel after Task 2.
Task 6 depends on Task 5 (uses StreamEvent component).
Task 8 wires everything together.
Task 9 is final polish.

---

## Execution Strategy

**Recommended:** Use `nexus:subagent-driven-development` with this parallelization:

- **Batch 1:** Task 1 + Task 2 (sequential, ~5 min)
- **Batch 2:** Tasks 3, 4, 5, 7 (parallel, ~10 min each)
- **Batch 3:** Task 6 (depends on Task 5, ~10 min)
- **Batch 4:** Task 8 (wire, ~5 min)
- **Batch 5:** Task 9 (polish + verify, ~10 min)

# Detail Pane Redesign — Implementation Plan

**Goal:** Rewrite the stream pane into 3 zones (prompt card, steps bar, block-style log viewer) with per-step filtering.
**Architecture:** Replace `stream-pane.tsx`, `stream-event.tsx`, and `phase-bar.tsx`. Keep `use-stream.ts` (add selectedPhase filtering), keep `pipeline.ts` (no changes). The 3 new components compose inside the existing `StreamPane` export so `App.tsx` doesn't change.
**Tech Stack:** React 19, Tailwind CSS v4, existing theme tokens.
**Spec:** specs/detail-pane-redesign/spec.md
**Plan:** specs/detail-pane-redesign/plan.md

**REQUIRED SUB-SKILL:** nexus:executing-plans (sequential — components depend on each other)

---

## File Map

### Rewrite (same paths, new content)

- `src/dashboard/src/components/stream-pane.tsx` — 3-zone layout shell
- `src/dashboard/src/components/stream-event.tsx` — block-style log entry renderer
- `src/dashboard/src/components/phase-bar.tsx` — clickable step bar with filtering

### Modify

- `src/dashboard/src/hooks/use-stream.ts` — add phase filtering logic + text batching

### No Changes

- `src/dashboard/src/lib/pipeline.ts` — already has everything needed
- `src/dashboard/src/App.tsx` — StreamPane props unchanged
- `src/dashboard/src/components/header.tsx` — untouched
- `src/dashboard/src/components/task-list.tsx` — untouched

---

## Task Breakdown

### Task 1: Rewrite stream-event.tsx — block-style log entries

**Files:**

- Rewrite: `src/dashboard/src/components/stream-event.tsx`

**Steps:**

- [ ] Step 1: Rewrite the component with block-style rendering for each event type:

  **tool_use block:**
  - Container: `bg-surface-2 border-l-4 border-accent rounded-r px-3 py-2 mx-2 my-1`
  - Line 1: `<span className="text-accent font-mono font-bold text-sm">toolName</span>` + timestamp right-aligned in `text-text-tertiary text-xs font-mono`
  - Line 2: smart preview (filePath for read/edit/write, command for bash, pattern for grep) in `text-text-secondary font-mono text-xs mt-0.5`

  **text_delta block:**
  - Container: `border-l border-border px-3 py-1.5 mx-2 my-1`
  - Text: `text-sm text-text-primary leading-relaxed whitespace-pre-wrap`
  - No individual timestamp

  **token_update chip:**
  - Only render if percent changed >=5 since last
  - Container: `text-center my-1`
  - Chip: `inline-block text-stream-token font-mono text-xs opacity-60`
  - Format: `⬡ 12% — 24.1K / 200K`

  **session_end banner:**
  - Container: `mx-2 my-2 px-4 py-3 rounded border`
  - Completed: `bg-status-completed/10 border-status-completed/20 text-status-completed`
  - Failed: `bg-status-failed/10 border-status-failed/20 text-status-failed`
  - Interrupted: `bg-status-running/10 border-status-running/20 text-status-running`
  - Icon + "Session {reason}"

  **routing_decision line:**
  - Container: `px-4 py-1 mx-2`
  - Text: `text-text-tertiary text-xs` — `→ {mode} · {complexity} · {reason}`

  **phase_start divider:**
  - Container: `bg-accent/10 border-y border-accent/20 px-4 py-2 mt-3`
  - Text: `text-accent font-bold text-xs uppercase tracking-wider` — phase name
  - Include attempt badge if attempt > 1

  **phase_end summary:**
  - Container: `px-4 py-1 mx-2 mb-2`
  - Success: `text-status-completed text-xs font-medium` — `✓ PHASE completed (12.3s)`
  - Failed: `text-status-failed text-xs font-medium` — `✗ PHASE failed`

  **heartbeat / unknown:** return null

- [ ] Step 2: Keep the same export: `export { StreamEventComponent }`
- [ ] Step 3: Keep the same props: `{ event: StreamEvent, now: number }`
- [ ] Step 4: Run `npm run build` in `src/dashboard/` — verify compiles
- [ ] Step 5: Commit: `feat: block-style log entry renderer`

---

### Task 2: Rewrite phase-bar.tsx — clickable step bar with filtering

**Files:**

- Rewrite: `src/dashboard/src/components/phase-bar.tsx`

**Steps:**

- [ ] Step 1: Rewrite with these props:

  ```typescript
  interface StepsBarProps {
    events: StreamEvent[];
    selectedPhase: string | null; // null = "All"
    onSelectPhase: (phase: string | null) => void;
  }
  ```

- [ ] Step 2: Layout: `h-12 flex items-center gap-0 px-4 border-b border-border bg-surface`

- [ ] Step 3: Render "All" button first:
  - `px-3 py-1 text-xs rounded cursor-pointer`
  - Active: `bg-accent/20 text-accent border border-accent/30`
  - Inactive: `text-text-secondary hover:text-text-primary`

- [ ] Step 4: For each phase in PHASE_ORDER, render a step node:
  - Connector line: `w-6 h-px` — `bg-status-completed` if prev phase completed, else `bg-border`
  - Node: `flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-colors`
  - Status icon (12px): completed=`text-status-completed ✓`, running=`text-status-running ●` (pulse), failed=`text-status-failed ✗`, pending=`text-text-tertiary ○`
  - Label: `text-xs font-medium` — PHASE_LABELS[phase]
  - Active state: `bg-accent/20 text-accent border border-accent/30`
  - Inactive: `text-text-secondary hover:bg-surface-2`
  - Retry badge: `text-[10px] bg-status-running/20 text-status-running px-1 rounded` — `×2`

- [ ] Step 5: Use `extractPhaseEvents()`, `getPhaseStatus()`, `getCurrentPhase()`, `getRetryCount()` from pipeline.ts
- [ ] Step 6: Export as `export { StepsBar }` (renamed from PhaseBar)
- [ ] Step 7: Run `npm run build` — verify compiles
- [ ] Step 8: Commit: `feat: clickable step bar with phase filtering`

---

### Task 3: Add phase filtering to use-stream.ts

**Files:**

- Modify: `src/dashboard/src/hooks/use-stream.ts`

**Steps:**

- [ ] Step 1: Add a helper function `getPhaseTimeWindows` that extracts start/end timestamps per phase from events:

  ```typescript
  function getPhaseTimeWindows(
    events: StreamEvent[],
  ): Map<string, { start: number; end: number }> {
    // Iterate events, find phase_start and phase_end, build map
    // phase_start data.phase = "execute", timestamp = start
    // phase_end data.phase = "execute", timestamp = end
    // If no phase_end yet, end = Infinity (still running)
  }
  ```

- [ ] Step 2: Add `filterEventsByPhase` function:

  ```typescript
  function filterEventsByPhase(
    events: StreamEvent[],
    phase: string | null,
  ): StreamEvent[] {
    if (!phase) return events; // "All" — no filtering
    const windows = getPhaseTimeWindows(events);
    const window = windows.get(phase);
    if (!window) return [];
    return events.filter((e) => {
      // Include the phase_start/phase_end markers themselves
      if (e.type === "phase_start" || e.type === "phase_end") {
        return (e.data.phase as string) === phase;
      }
      // Include events within the time window
      return e.timestamp >= window.start && e.timestamp <= window.end;
    });
  }
  ```

- [ ] Step 3: Export both functions so `stream-pane.tsx` can use them
- [ ] Step 4: Run `npm run build` — verify compiles
- [ ] Step 5: Commit: `feat: phase filtering for stream events`

---

### Task 4: Rewrite stream-pane.tsx — 3-zone layout with state management

**Files:**

- Rewrite: `src/dashboard/src/components/stream-pane.tsx`

**Steps:**

- [ ] Step 1: Keep the same props interface (App.tsx doesn't change):

  ```typescript
  interface StreamPaneProps {
    task: TaskFull | null;
    events: StreamEvent[];
    isLive: boolean;
  }
  ```

- [ ] Step 2: Add internal state:

  ```typescript
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  ```

  Reset to null when `task` changes.

- [ ] Step 3: Compute:

  ```typescript
  const isPipeline = events.some(
    (e) => e.type === "phase_start" || e.type === "phase_end",
  );
  const filteredEvents = filterEventsByPhase(events, selectedPhase);
  ```

- [ ] Step 4: Layout the 3 zones:

  ```
  <div className="flex-1 h-full flex flex-col bg-bg overflow-hidden">
    {/* Zone 1: Prompt Card */}
    <PromptCard task={task} isLive={isLive} />

    {/* Zone 2: Steps Bar (pipeline only) */}
    {isPipeline && (
      <StepsBar
        events={events}
        selectedPhase={selectedPhase}
        onSelectPhase={setSelectedPhase}
      />
    )}

    {/* Zone 3: Log Viewer */}
    <LogViewer events={filteredEvents} task={task} />
  </div>
  ```

- [ ] Step 5: Implement `PromptCard` as inline component:
  - Container: `max-h-[15vh] shrink-0 overflow-hidden border-b border-border px-4 py-3`
  - Badge row: status pill + model badge + duration + LIVE badge
  - Prompt: `overflow-y-auto` area with `text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary` inside `bg-surface-2/40 rounded border border-border px-3 py-2 mt-2`

- [ ] Step 6: Implement `LogViewer` as inline component:
  - Container: `flex-1 min-h-0 overflow-y-auto` with ref for auto-scroll
  - Auto-scroll: scroll to bottom on new events, pause when user scrolls up, resume at bottom
  - Maps `filteredEvents` to `StreamEventComponent`
  - Empty states per FR-040/041/042

- [ ] Step 7: Import `StepsBar` from `./phase-bar` and `filterEventsByPhase` from `../hooks/use-stream`
- [ ] Step 8: Run `npm run build` — verify compiles
- [ ] Step 9: Commit: `feat: 3-zone detail pane with step filtering`

---

### Task 5: Visual polish and verify

**Steps:**

- [ ] Step 1: Run `npm run build` — zero errors
- [ ] Step 2: Take Playwright screenshot at 1920x1080 with data
- [ ] Step 3: Verify all spec requirements:
  - FR-001 to FR-006 (prompt card)
  - FR-010 to FR-018 (steps bar)
  - FR-020 to FR-022 (log viewer scroll)
  - FR-030 to FR-038 (log entries)
  - FR-040 to FR-042 (empty states)
- [ ] Step 4: Test clicking between steps — logs filter correctly
- [ ] Step 5: Test with a live `claw run` — events stream in real-time
- [ ] Step 6: Fix any visual issues
- [ ] Step 7: Commit: `feat: detail pane redesign complete`

---

## Dependency Graph

```
Task 1 (stream-event) ─┐
Task 2 (steps bar)     ─┼→ Task 4 (stream-pane) → Task 5 (polish)
Task 3 (use-stream)    ─┘
```

Tasks 1, 2, 3 are independent — can run in parallel.
Task 4 depends on all three.
Task 5 is final verification.

## Execution Strategy

- **Batch 1:** Tasks 1, 2, 3 (parallel via claw)
- **Batch 2:** Task 4 (sequential, wires everything)
- **Batch 3:** Task 5 (manual verification + fixes)

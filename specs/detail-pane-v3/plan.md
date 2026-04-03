# Detail Pane v3 — Implementation Plan

**Goal:** Intent title via LLM, prompt modal, large pipeline cards, clean flat log entries.
**Architecture:** Backend change in classifier.ts + run.ts for title generation. Dashboard: rewrite stream-pane, stream-event, phase-bar. Add prompt-modal component.
**Tech Stack:** React 19, Tailwind CSS v4, existing theme tokens.
**Spec:** specs/detail-pane-v3/spec.md
**Plan:** specs/detail-pane-v3/plan.md

---

## File Map

### Backend (modify)

- `src/core/classifier.ts` — extend classifyTask to return title
- `src/cli/commands/run.ts` — use generated title for work item

### Dashboard (rewrite)

- `src/dashboard/src/components/stream-event.tsx` — clean flat entries, no bg/border
- `src/dashboard/src/components/phase-bar.tsx` — large clickable cards
- `src/dashboard/src/components/stream-pane.tsx` — 3-zone with header+cards+logs
- `src/dashboard/src/components/prompt-modal.tsx` — NEW: full prompt modal

### Dashboard (minor modify)

- `src/dashboard/src/components/task-item.tsx` — show shorter description

---

## Tasks

### Task 1: Extend classifyTask to generate intent title

**Files:**

- Modify: `src/core/classifier.ts`
- Modify: `src/cli/commands/run.ts`

**Steps:**

- [ ] Step 1: Read `src/core/classifier.ts` to understand the current classifyTask prompt and response parsing
- [ ] Step 2: Modify the LLM prompt to also ask for a `title` field (max 60 chars, summarize intent). Change expected JSON output from `{ "complexity": "..." }` to `{ "complexity": "...", "title": "..." }`
- [ ] Step 3: Update the return type to `{ complexity: string, title: string }`
- [ ] Step 4: Add fallback: if title is missing or empty, use `prompt.slice(0, 60)`
- [ ] Step 5: In `run.ts`, update the `createWorkItem` call to use the generated title instead of `prompt.slice(0, 120)`
- [ ] Step 6: Run `npx tsc --noEmit` and `npm test` — verify zero errors
- [ ] Step 7: Commit: `feat: LLM-generated intent title for tasks`

---

### Task 2: Clean flat stream-event.tsx (no bg, no borders on tools)

**Files:**

- Rewrite: `src/dashboard/src/components/stream-event.tsx`

**Steps:**

- [ ] Step 1: Rewrite with these rendering rules (NO backgrounds, NO borders on tool blocks):

  **tool_use:** `py-2 px-4` flat row. Line 1: `text-accent font-mono font-bold text-sm` tool name + `text-text-tertiary text-xs font-mono ml-auto` timestamp. Line 2: smart path/command in `text-text-secondary font-mono text-xs`. No bg, no border.

  **text_delta:** `py-1 px-4`. Proportional font. `> ` prefix in text-tertiary. Content in `text-text-secondary text-sm`. Batch consecutive within 2s.

  **token_update:** `py-1 text-center`. Only render if percent changed >=5. `text-stream-token font-mono text-xs opacity-60`. Format: `⬡ 12% — 24.1K / 200K`

  **session_end:** `mx-4 my-3 px-4 py-3 rounded border` with tinted bg. Green completed, red failed, yellow interrupted.

  **routing_decision:** `py-1 px-4 text-text-tertiary text-xs`. Format: `→ mode · complexity · reason`

  **phase_start:** `mt-3 py-1.5 px-4 border-t border-accent/20`. Phase name: `text-accent text-xs font-bold uppercase tracking-wider`

  **phase_end:** `py-1 px-4` compact. `✓ PHASE completed (12.3s)` or `✗ PHASE failed` in status color.

  **heartbeat/unknown:** return null.

- [ ] Step 2: Keep export `{ StreamEventComponent }` and props `{ event: StreamEvent, now: number }`
- [ ] Step 3: Run `npm run build` in `src/dashboard/` — verify compiles
- [ ] Step 4: Commit: `feat: clean flat log entries without visual noise`

---

### Task 3: Large clickable pipeline cards

**Files:**

- Rewrite: `src/dashboard/src/components/phase-bar.tsx`

**Steps:**

- [ ] Step 1: Rewrite with props:

  ```typescript
  interface PipelineCardsProps {
    events: StreamEvent[];
    selectedPhase: string | null;
    onSelectPhase: (phase: string | null) => void;
  }
  ```

- [ ] Step 2: Layout: `flex items-stretch gap-3 px-4 py-3 border-b border-border`

- [ ] Step 3: "All" button: `shrink-0 px-4 py-3 rounded-lg border cursor-pointer transition-colors text-center`. Active: `bg-accent/10 border-accent text-accent`. Inactive: `border-border text-text-secondary hover:border-border-active`.

- [ ] Step 4: Each phase card: `flex-1 rounded-lg border cursor-pointer transition-colors px-4 py-3 text-center`
  - Row 1: phase name `text-xs uppercase tracking-wider font-bold`
  - Row 2: status icon `text-2xl my-1` — completed: `✓` green, running: `●` amber with `animate-pulse`, failed: `✗` red, pending: `○` tertiary
  - Row 3: duration `text-xs text-text-tertiary` or `—` if no duration
  - Retry badge: `text-[10px] px-1 rounded bg-status-running/20 text-status-running` inline after phase name

- [ ] Step 5: Card border states:
  - Completed: `border-status-completed/30`
  - Running: `border-status-running/30`
  - Failed: `border-status-failed/30`
  - Pending: `border-border`
  - Selected: `bg-accent/10 border-accent` (overrides status border)

- [ ] Step 6: Click handler: if clicking already selected phase, set null (toggle). Otherwise set phase.

- [ ] Step 7: Use `extractPhaseEvents`, `getPhaseStatus`, `getCurrentPhase`, `getRetryCount`, `formatDuration`, `getTotalDuration` from `lib/pipeline.ts`

- [ ] Step 8: Export as `{ PipelineCards }`
- [ ] Step 9: Run `npm run build` — verify compiles
- [ ] Step 10: Commit: `feat: large clickable pipeline phase cards`

---

### Task 4: Prompt modal component

**Files:**

- Create: `src/dashboard/src/components/prompt-modal.tsx`

**Steps:**

- [ ] Step 1: Create component:

  ```typescript
  interface PromptModalProps {
    prompt: string;
    onClose: () => void;
  }
  ```

- [ ] Step 2: Render as portal (`createPortal` to `document.body`):
  - Backdrop: `fixed inset-0 z-50 bg-black/60 flex items-center justify-center`
  - Modal: `bg-surface border border-border rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col mx-4`
  - Header: `px-4 py-3 border-b border-border flex items-center justify-between`. Title: "Task Prompt". Close: `cursor-pointer text-text-tertiary hover:text-text-primary text-lg` — `×`
  - Body: `flex-1 overflow-y-auto px-4 py-4`. Prompt text: `font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary`

- [ ] Step 3: Close on backdrop click (not modal body click — use `stopPropagation`) and Escape key (`useEffect` with keydown listener)

- [ ] Step 4: Export as `{ PromptModal }`
- [ ] Step 5: Run `npm run build` — verify compiles
- [ ] Step 6: Commit: `feat: prompt modal component`

---

### Task 5: Wire stream-pane.tsx — header + cards + logs + modal

**Files:**

- Rewrite: `src/dashboard/src/components/stream-pane.tsx`

**Steps:**

- [ ] Step 1: Keep same exported props (App.tsx unchanged):

  ```typescript
  interface StreamPaneProps {
    task: TaskFull | null;
    events: StreamEvent[];
    isLive: boolean;
  }
  ```

- [ ] Step 2: Internal state:

  ```typescript
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  ```

  Reset both when task changes.

- [ ] Step 3: Compute:

  ```typescript
  const isPipeline = events.some(
    (e) => e.type === "phase_start" || e.type === "phase_end",
  );
  const filteredEvents = filterEventsByPhase(events, selectedPhase);
  ```

- [ ] Step 4: Layout:

  ```
  <div className="flex-1 h-full flex flex-col bg-bg overflow-hidden">
    {/* Header: title + badges + Prompt button */}
    <div className="px-4 py-3 border-b border-border shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="text-text-primary font-medium text-sm truncate">
          {task.description.slice(0, 80)}
        </h2>
        <button onClick={() => setShowPrompt(true)}
          className="text-accent text-xs cursor-pointer hover:underline shrink-0 ml-3">
          Prompt
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {/* status pill, model badge, duration, LIVE badge */}
      </div>
    </div>

    {/* Pipeline cards (only if pipeline) */}
    {isPipeline && (
      <PipelineCards events={events} selectedPhase={selectedPhase} onSelectPhase={setSelectedPhase} />
    )}

    {/* Log viewer */}
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto py-2">
      {filteredEvents.map(...)}
    </div>

    {/* Prompt modal */}
    {showPrompt && task && (
      <PromptModal prompt={task.description} onClose={() => setShowPrompt(false)} />
    )}
  </div>
  ```

- [ ] Step 5: Auto-scroll logic: same as before (ref + 50px threshold)
- [ ] Step 6: Empty states: no task = "Select a task", no events = "Waiting for events...", no events in phase = "No events in this phase"
- [ ] Step 7: Import PipelineCards from ./phase-bar, PromptModal from ./prompt-modal, StreamEventComponent from ./stream-event, filterEventsByPhase from ../hooks/use-stream
- [ ] Step 8: Run `npm run build` — verify compiles
- [ ] Step 9: Commit: `feat: detail pane v3 with intent header, pipeline cards, prompt modal`

---

### Task 6: Build, screenshot, verify

- [ ] Step 1: Run `npm run build` — zero errors
- [ ] Step 2: Take Playwright screenshot 1920x1080
- [ ] Step 3: Verify visually: header compact, cards large, logs clean
- [ ] Step 4: Test clicking pipeline cards — logs filter
- [ ] Step 5: Test Prompt button — modal opens with full text
- [ ] Step 6: Commit all + push

---

## Dependency Graph

```
Task 1 (classifier) ──────────────────────────┐
Task 2 (stream-event) ─┐                      │
Task 3 (pipeline cards) ┼→ Task 5 (wire) → Task 6
Task 4 (prompt modal)  ─┘
```

Tasks 1-4 are independent. Task 5 wires them. Task 6 verifies.

## Execution via Claw

- **Batch 1:** Tasks 1, 2, 3, 4 (4 parallel claw runs)
- **Batch 2:** Task 5 (1 claw run, depends on all)
- **Batch 3:** Task 6 (manual verification)

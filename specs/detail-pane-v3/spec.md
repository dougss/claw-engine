# Detail Pane v3 — Specification

## Purpose

Redesign the detail pane with: LLM-generated intent title (short), prompt in a modal, pipeline phases as large clickable cards, and clean log entries without visual noise (no backgrounds, no borders on tool calls).

## Changes Summary

### 1. Intent Title (backend)

When `classifyTask()` runs in `run.ts`, also generate a short title (max 60 chars) summarizing the task intent. Store in the work item `title` field (already exists, currently uses `prompt.slice(0,120)`).

### 2. Detail Pane Layout

```
┌──────────────────────────────────────────────────────┐
│  Fix parallel tool execution bugs + add tests        │
│  completed · opencode · 45s              [Prompt]    │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │   PLAN   │ │ EXECUTE  │ │ VALIDATE │ │ REVIEW │  │
│  │    ✓     │ │    ●     │ │    ○     │ │   ○    │  │
│  │   2.3s   │ │   45s    │ │    —     │ │   —    │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
├──────────────────────────────────────────────────────┤
│                                                        │
│  read  src/harness/agent-loop.ts                  12s  │
│                                                        │
│  edit  src/harness/agent-loop.ts                  14s  │
│                                                        │
│  bash  npm test                                   15s  │
│                                                        │
│  ⬡ 12% — 24.1K / 200K                                 │
│                                                        │
│  > Implementing the fix for the parallel tool...       │
│                                                        │
└──────────────────────────────────────────────────────┘
```

### 3. Prompt Modal

Standard modal overlay. Opens on "Prompt" button click. Shows full prompt text with monospace font, scrollable. Close with X button or click outside.

### 4. Pipeline Cards

Large cards in a horizontal row, full width. Each card:

- Phase name (bold, centered)
- Status icon (large: ✓ green, ● amber pulse, ✗ red, ○ gray)
- Duration below
- Clickable — filters logs to that phase
- Active state: accent border
- Retry badge if applicable

For non-pipeline tasks: no cards shown, logs take full space.

### 5. Log Entries (clean)

NO backgrounds, NO borders on tool_use blocks. Clean flat list:

- `tool_use`: tool name in accent color (bold mono) + path in secondary. Timestamp right-aligned. One blank line between entries.
- `text_delta`: prefixed with `>` in tertiary color, proportional font. Batched consecutive deltas.
- `token_update`: centered chip, small, amber, opacity 60%. Only if >=5% change.
- `session_end`: colored banner (green/red/yellow).
- `routing_decision`: subtle gray one-liner at top.
- `phase_start`: thin accent divider with phase name.
- `phase_end`: compact summary line.
- `heartbeat`/unknown: null.

## Functional Requirements

### Intent Title Generation

- **FR-001:** `classifyTask()` in `src/core/classifier.ts` MUST be extended to also return a `title` field (max 60 chars)
- **FR-002:** The classifier prompt MUST ask the LLM to output JSON with both `complexity` and `title`
- **FR-003:** `run.ts` MUST use the generated title for the work item `title` field instead of `prompt.slice(0,120)`
- **FR-004:** If title generation fails, fall back to `prompt.slice(0,60)`

### Task List

- **FR-010:** `task-item.tsx` MUST show the work item title (intent) instead of `task.description`
- **FR-011:** Since tasks don't have the work item title, the `useTasks` hook MUST fetch from `/api/v1/work-items?with_tasks=1` to get titles, or the task list shows `description.slice(0,60)` as fallback

### Detail Pane Header

- **FR-020:** Header row: intent title (left, bold, truncated one line) + "Prompt" button (right)
- **FR-021:** Below title: badge row — status pill, model badge, duration
- **FR-022:** "Prompt" button: text button `text-accent text-xs cursor-pointer hover:underline`

### Prompt Modal

- **FR-030:** Modal: centered overlay, `max-w-2xl w-full max-h-[80vh]`, dark surface bg, border
- **FR-031:** Modal header: "Task Prompt" + close X button
- **FR-032:** Modal body: full prompt text in `font-mono text-sm leading-relaxed whitespace-pre-wrap` with scroll
- **FR-033:** Click outside or press Escape closes modal
- **FR-034:** Modal uses portal (rendered at body level) to avoid z-index issues

### Pipeline Cards

- **FR-040:** Cards render in a horizontal flex row with `gap-3`, full width, `px-4 py-3`
- **FR-041:** Each card: `flex-1 rounded-lg border cursor-pointer transition-colors px-4 py-3 text-center`
- **FR-042:** Card content: phase name (xs, uppercase, tracking-wider), status icon (text-2xl), duration (xs, tertiary)
- **FR-043:** Card states:
  - Completed: `border-status-completed/30 text-status-completed`
  - Running: `border-status-running/30 text-status-running` + pulse on icon
  - Failed: `border-status-failed/30 text-status-failed`
  - Pending: `border-border text-text-tertiary`
  - Selected/Active: `bg-accent/10 border-accent`
- **FR-044:** Clicking a card sets selectedPhase, clicking again (or clicking "All") resets to null
- **FR-045:** "All" button before the cards, same height, `shrink-0`
- **FR-046:** Retry badge on card: small `×2` pill

### Log Entries

- **FR-050:** `tool_use`: NO background, NO border. Layout: `py-2 px-4`. Line 1: tool name in `text-accent font-mono font-bold text-sm` + timestamp right in `text-text-tertiary text-xs font-mono`. Line 2: smart path preview in `text-text-secondary font-mono text-xs`.
- **FR-051:** `text_delta`: `py-1 px-4`. Content: `text-text-secondary text-sm` with `> ` prefix in `text-text-tertiary`. Batch consecutive deltas within 2s.
- **FR-052:** `token_update`: `py-1 text-center`. Only if >=5% change. `text-stream-token font-mono text-xs opacity-60`.
- **FR-053:** `session_end`: `mx-4 my-3 px-4 py-3 rounded border` with status-colored bg tint.
- **FR-054:** `routing_decision`: `py-1 px-4 text-text-tertiary text-xs`.
- **FR-055:** `phase_start`: `mt-3 py-1 px-4 border-t border-accent/20`. Phase name in `text-accent text-xs font-bold uppercase tracking-wider`.
- **FR-056:** `phase_end`: `py-1 px-4`. Status icon + phase + duration in matching color.
- **FR-057:** `heartbeat`/unknown: return null.

## Out of Scope

- Header / KPIs
- Task list left pane (only minor: show title instead of description)
- New API endpoints
- Mobile layout

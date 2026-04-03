# Detail Pane Redesign Specification

## Purpose

Redesign the stream pane (right side of the dashboard) into 3 clear vertical zones: prompt card, pipeline steps bar, and formatted log viewer. Pipeline runs show step-by-step phases where clicking a step filters logs to only that phase. Log entries use block-style rendering with monospace font, clear visual hierarchy, and proper spacing.

## User Stories

### US-1: Read the prompt clearly (P1)

As a developer, I want to see the full task prompt in a well-formatted card at the top, so I know what the agent was asked to do without squinting at truncated text.

**Acceptance Scenarios:**

- Given a task is selected, When I view the detail pane, Then I see a card with status badges on top and the full prompt below with word wrap
- Given the prompt is very long, When it exceeds the card height, Then the card is scrollable internally (max ~15vh)

### US-2: Navigate pipeline steps (P1)

As a developer, When a task ran in pipeline mode, I want to see each phase as a clickable step in a horizontal bar, so I can jump to the logs of any specific phase.

**Acceptance Scenarios:**

- Given a pipeline task is selected, When I view the detail pane, Then I see a horizontal step bar showing PLAN → EXECUTE → VALIDATE → REVIEW → PR
- Given I click on EXECUTE, Then the log viewer below shows only events from the EXECUTE phase
- Given a step is completed, Then it shows a green check. Running shows amber pulse. Failed shows red X. Pending shows gray circle
- Given EXECUTE had retries, Then the step shows an attempt badge (×2)

### US-3: Non-pipeline tasks skip the step bar (P1)

As a developer, When a task is a simple delegate run (not pipeline), I want the step bar hidden and logs taking the full space.

**Acceptance Scenarios:**

- Given a non-pipeline task is selected, Then no step bar renders and logs occupy ~85% of the detail pane

### US-4: Read logs with clear visual blocks (P1)

As a developer, I want each log entry to be a visually distinct block (not a flat line), so I can scan tool calls, text output, and token updates at a glance.

**Acceptance Scenarios:**

- Given a tool_use event, Then it renders as a card-like block: tool name bold in accent color on the first line, file path or input preview on the second line in secondary color, all in monospace
- Given a text_delta event, Then consecutive text deltas are batched into a single prose block with proportional font
- Given a token_update event, Then it renders as a compact inline chip (not a full-width row). Only show if percent changed by >=5 since last rendered
- Given a session_end event, Then it renders as a full-width colored banner (green/red/yellow)
- Given a routing_decision event, Then it renders as a subtle gray line at the top of the logs
- Given a phase_start event, Then it renders as a section divider with the phase name
- Given a heartbeat event, Then it is not rendered

### US-5: Live events appear in real-time (P1)

As a developer, When a task is running, I want new events to appear instantly via SSE with auto-scroll.

**Acceptance Scenarios:**

- Given a running task is selected, When a new event arrives via SSE, Then it appears at the bottom of the log viewer
- Given I have scrolled up to inspect older logs, Then auto-scroll pauses
- Given I scroll back to the bottom, Then auto-scroll resumes

## Functional Requirements

### Prompt Card (Zone 1)

- **FR-001:** The prompt card MUST render at the top of the detail pane, taking max 15vh
- **FR-002:** The card MUST show a row of badges: status (colored pill), model (mono text), duration
- **FR-003:** Below the badges, the full prompt text MUST render with `whitespace-pre-wrap` and `break-words`
- **FR-004:** If the prompt exceeds the card height, the card MUST scroll internally
- **FR-005:** The card MUST have a subtle border and slightly elevated background (`surface-2`)
- **FR-006:** When a LIVE task is selected, the card SHOULD show a LIVE badge pulsing

### Steps Bar (Zone 2)

- **FR-010:** The steps bar MUST only render when the task has pipeline telemetry (phase_start/phase_end events)
- **FR-011:** Each step MUST render as a clickable pill/tab with: status icon + phase label
- **FR-012:** Step status icons: completed = green check, running = amber pulse, failed = red X, pending = gray circle
- **FR-013:** Steps MUST be connected by a horizontal line (like a progress track)
- **FR-014:** Clicking a step MUST filter the log viewer to show only events within that phase's time window
- **FR-015:** The currently selected step MUST have an active visual state (border highlight or background)
- **FR-016:** An "All" option MUST exist to show all events unfiltered
- **FR-017:** If a phase has retries (multiple phase_start for same phase), the step MUST show attempt count badge
- **FR-018:** The steps bar MUST be ~48px fixed height with horizontal layout

### Log Viewer (Zone 3)

- **FR-020:** The log viewer MUST occupy all remaining vertical space below the steps bar (or prompt card if no steps)
- **FR-021:** The log viewer MUST be independently scrollable with auto-scroll behavior
- **FR-022:** Auto-scroll MUST pause when user scrolls up (>50px from bottom) and resume when user returns to bottom

#### Log Entry Rendering

- **FR-030:** `tool_use` MUST render as a block with:
  - Background: `surface-2` with left border in accent color (4px)
  - Line 1: tool name in accent color, bold, monospace
  - Line 2: smart preview — file path for read/edit/write, command for bash, pattern for grep/glob. Monospace, secondary color
  - Padding: `px-3 py-2`, margin-bottom between blocks
  - Timestamp on the right of line 1, small, tertiary color

- **FR-031:** `text_delta` events that arrive within 2 seconds of each other MUST be batched into a single prose block with:
  - Proportional font (sans), normal text color, `leading-relaxed`
  - No individual timestamps per delta — one timestamp for the batch
  - Light left border (1px, subtle) to distinguish from tool blocks

- **FR-032:** `token_update` MUST render as a compact inline chip:
  - Only render if `percent` changed by >=5 since last rendered token_update
  - Format: `⬡ 12% — 24.1K / 200K` in small monospace, amber color, opacity 60%
  - Centered, not full-width

- **FR-033:** `session_end` MUST render as a full-width banner:
  - Completed: green background tint, check icon, "Session completed"
  - Failed: red background tint, X icon, "Session failed: {reason}"
  - Interrupted: yellow background tint, pause icon, "Session interrupted"

- **FR-034:** `routing_decision` MUST render as a subtle one-line header:
  - Format: `→ delegate · medium · opencode (simple/medium task → opencode)`
  - Gray color, small text, no block styling

- **FR-035:** `phase_start` MUST render as a section divider:
  - Full-width, accent background tint, phase name uppercase, bold
  - Acts as visual separator between phases in "All" view

- **FR-036:** `phase_end` MUST render as a compact summary line:
  - Format: `✓ EXECUTE completed (12.3s)` or `✗ VALIDATE failed`
  - Green or red color matching status

- **FR-037:** `heartbeat` MUST NOT render

- **FR-038:** Unknown event types MUST NOT render (return null, not JSON dump)

### Empty States

- **FR-040:** No task selected: centered text "Select a task to view its output"
- **FR-041:** Task selected but no events: "Waiting for events..." with subtle pulse animation
- **FR-042:** Step selected but no events in that phase: "No events in this phase"

## Non-Functional Requirements

- **NFR-001:** Log viewer MUST handle 1000+ events without jank (consider virtualization if needed)
- **NFR-002:** Font stack: JetBrains Mono for log entries and tool names, Inter/system-ui for prose text
- **NFR-003:** All colors from existing Tailwind theme tokens — no new hardcoded values
- **NFR-004:** Dark mode only

## Design Tokens (from UI/UX Pro Max)

Use existing theme. Key references:

| Element          | Token                  |
| ---------------- | ---------------------- |
| Log block bg     | `surface-2`            |
| Tool name        | `accent` (teal)        |
| Tool left border | `accent` 4px           |
| Text content     | `text-primary`         |
| Secondary info   | `text-secondary`       |
| Timestamp        | `text-tertiary` mono   |
| Token chip       | `stream-token` (amber) |
| Success banner   | `status-completed`     |
| Failed banner    | `status-failed`        |
| Phase divider    | `accent/10` bg         |
| Step active      | `accent` border        |
| Step pending     | `text-tertiary`        |

## Out of Scope

- Task list (left pane) — not touched
- Header / KPIs — not touched
- Adding new API endpoints
- Task actions (cancel, retry)
- Keyboard shortcuts
- Mobile layout

## Open Questions

None — all resolved.

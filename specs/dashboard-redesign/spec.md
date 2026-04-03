# Dashboard Redesign Specification

## Purpose

Redesign the Claw Engine dashboard from a 5-page multi-tab layout into a single-view passive monitor that shows live agent output in real-time, with a task list for context and compact KPIs in the header. The dashboard is a "background TV board" — open it, glance at what's running, close it.

## User Stories

### US-1: Glance at running tasks (P1)

As a developer, I want to open the dashboard and immediately see what tasks are running and their live output, so I can monitor agent work without switching to a terminal.

**Acceptance Scenarios:**

- Given a task is running, When I open the dashboard, Then I see it highlighted in the task list and its live stream auto-selected in the detail pane
- Given no tasks are running, When I open the dashboard, Then I see the most recent completed task selected
- Given multiple tasks are running, When I open the dashboard, Then the most recently started task is auto-selected

### US-2: Watch live agent output (P1)

As a developer, I want to see the agent's tool calls, text output, and progress in real-time, so I know what it's doing without reading raw JSON.

**Acceptance Scenarios:**

- Given a task is running, When I view its stream, Then I see formatted events: tool calls (with name + preview), text output, and token updates
- Given a tool_use event arrives, Then it renders as `[tool] ToolName(input preview...)` with semantic color
- Given a text_delta event arrives, Then it renders as readable text (not JSON)
- Given a session_end event arrives, Then the stream shows a completion banner with reason
- Given the stream has many events, Then it auto-scrolls to the latest event

### US-3: See pipeline phases (P1)

As a developer, When a task runs in pipeline mode, I want to see a phase progress bar (PLAN → EXECUTE → VALIDATE → REVIEW → PR) above the stream, so I know which phase is active.

**Acceptance Scenarios:**

- Given a pipeline task is running, When I view it, Then I see a horizontal phase bar showing completed/active/pending phases with status icons
- Given the EXECUTE phase is active, Then the stream shows only EXECUTE phase events
- Given VALIDATE fails and retries EXECUTE, Then the phase bar reflects the retry (attempt counter)

### US-4: Glance at KPIs (P2)

As a developer, I want a compact header row showing key metrics, so I get a quick sense of system activity.

**Acceptance Scenarios:**

- Given I open the dashboard, Then the header shows: tasks today (running/completed/failed), total tokens used today, estimated cost today
- Given a task completes, Then the KPIs update in real-time via SSE

### US-5: See task result and PR link (P2)

As a developer, When a task completes, I want to see its outcome (pass/fail) and a clickable PR link if one was created.

**Acceptance Scenarios:**

- Given a task completed with a PR, When I view it, Then I see a PR badge with clickable link
- Given a task failed, When I view it, Then I see the error message and error class

## Functional Requirements

### Layout

- **FR-001:** The dashboard MUST be a single view — no tabs, no sidebar navigation, no routing
- **FR-002:** The layout MUST be a horizontal split: task list (left, ~320px) + stream pane (right, flex)
- **FR-003:** A header bar MUST sit above the split, containing the logo and KPI chips
- **FR-004:** The task list MUST be scrollable independently of the stream pane
- **FR-005:** The stream pane MUST be scrollable with auto-scroll to bottom (latest event)
- **FR-006:** Auto-scroll SHOULD pause when user scrolls up, and resume when user scrolls to bottom

### Task List (left pane)

- **FR-010:** Each task item MUST show: status dot (color-coded), title (truncated), time ago, model badge
- **FR-011:** Status dot colors: running (amber pulse), completed (green), failed (red), pending (gray)
- **FR-012:** The currently selected task MUST be visually highlighted
- **FR-013:** Clicking a task MUST switch the stream pane to that task's events
- **FR-014:** Running tasks MUST appear at the top, sorted by startedAt desc
- **FR-015:** Completed/failed tasks MUST appear below running tasks, sorted by completedAt desc
- **FR-016:** The list MUST load the 50 most recent tasks on mount via `GET /api/v1/tasks?limit=50`
- **FR-017:** New tasks MUST appear in the list in real-time via the global SSE stream

### Stream Pane (right pane)

- **FR-020:** For running tasks, the pane MUST connect to `GET /api/v1/tasks/:id/stream` (SSE) and render events live
- **FR-021:** For completed tasks, the pane MUST load historical events from `GET /api/v1/tasks/:id` (telemetry array)
- **FR-022:** Events MUST render with semantic formatting by type:
  - `tool_use` → `[tool] name(input_preview)` — cyan/teal color, monospace, input truncated to 80 chars
  - `text_delta` → rendered as readable text — default text color, proportional font
  - `token_update` → compact progress indicator (only show on significant changes, e.g. every 5%)
  - `session_end` → full-width banner: green "Completed" / red "Failed: reason" / yellow "Interrupted"
  - `routing_decision` → subtle chip: "routed → opencode (medium)" — gray, small
  - `heartbeat` → NOT rendered (filtered out)
- **FR-023:** The stream MUST show a timestamp (relative, e.g. "2s ago") on the left of each event
- **FR-024:** Text deltas that arrive in quick succession SHOULD be batched into paragraphs (not one line per delta)

### Pipeline Phase Bar

- **FR-030:** When a task has pipeline telemetry (phase_start/phase_end events), a horizontal phase bar MUST render above the stream
- **FR-031:** Phases render as: icon + label, connected by a line. States: completed (green check), active (amber spinner), pending (gray circle), failed (red X)
- **FR-032:** Clicking a phase SHOULD filter the stream to only show events from that phase
- **FR-033:** If the task is not a pipeline run, the phase bar MUST NOT render

### Header KPIs

- **FR-040:** The header MUST show 3-4 compact KPI chips in a row:
  - Running: count of currently running tasks (with green dot if > 0)
  - Today: completed / failed count
  - Tokens: total tokens used today (formatted: "12.4K")
  - Cost: estimated cost today (formatted: "$0.08")
- **FR-041:** KPIs MUST update in real-time via the global SSE stream
- **FR-042:** KPI chips MUST be compact (not large cards) — inline with the header

### Connection & State

- **FR-050:** The dashboard MUST connect to `GET /api/v1/events` (global SSE) on mount for real-time updates
- **FR-051:** The dashboard MUST show a connection indicator: green dot "LIVE" when SSE connected, red dot "DISCONNECTED" when not
- **FR-052:** On SSE disconnect, the dashboard MUST auto-reconnect with exponential backoff
- **FR-053:** On reconnect, the dashboard MUST use Last-Event-ID to replay missed events

## Non-Functional Requirements

- **NFR-001:** First meaningful paint MUST be under 1 second on local network
- **NFR-002:** The dashboard MUST work in Chrome and Safari (latest versions)
- **NFR-003:** The dashboard MUST render correctly at 1440x900 and above
- **NFR-004:** The stream pane MUST handle 10,000+ events without performance degradation (virtualized list)
- **NFR-005:** Dark mode only — no light mode toggle needed

## Design Direction

### Visual Identity

- **Dark-mode-native** (Linear-inspired): background `#0a0a0b`, not a dark theme over light
- **Single accent color**: emerald/teal (current brand, keep it)
- **Border-based depth**: `rgba(255,255,255,0.06)` borders, no box-shadows
- **Text hierarchy via opacity**: primary (90%), secondary (60%), tertiary (40%)
- **Monospace for stream events**: Geist Mono or JetBrains Mono
- **Proportional for UI chrome**: Inter or Geist Sans

### Semantic Colors for Stream Events

| Event                     | Color               | Inspiration                   |
| ------------------------- | ------------------- | ----------------------------- |
| tool_use                  | Teal/Cyan `#2dd4bf` | Cursor-style operation colors |
| text_delta                | White 90% opacity   | Default readable text         |
| token_update              | Amber `#f59e0b`     | Warning/progress tone         |
| session_end (success)     | Green `#22c55e`     | Universal success             |
| session_end (failed)      | Red `#ef4444`       | Universal error               |
| session_end (interrupted) | Yellow `#eab308`    | Warning                       |
| routing_decision          | Gray 40% opacity    | Subtle metadata               |

### Component Patterns

- Status dots: 8px circle with color, pulse animation for running
- Badges: pill-shaped, semi-transparent background tinted with status color
- KPI chips: inline, `value label` format (e.g., "3 running", "12.4K tokens")
- Stream entries: left-aligned timestamp + icon + content, no borders between entries
- Phase bar: horizontal flex, nodes connected by line, fixed height ~48px

## Tech Stack

- React 19 (existing)
- Vite (existing)
- Tailwind CSS v4 (existing)
- No component library — hand-rolled with Tailwind (simpler than adding shadcn for a monitor)
- @tanstack/react-virtual for stream virtualization (if needed for perf)
- EventSource API for SSE (native, no library needed)

## Out of Scope

- Light mode
- Mobile/responsive layout below 1440px
- Task submission from dashboard (CLI only)
- Task actions (cancel, retry, approve) from dashboard
- DAG visualization (reintroduce when pipeline mode is mature)
- Detailed metrics/charts page (add later when there's enough historical data)
- Authentication/multi-user
- Settings/configuration page
- Keyboard shortcuts

## Open Questions

None — all resolved during brainstorming.

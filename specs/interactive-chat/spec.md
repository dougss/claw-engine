# Interactive Chat CLI Specification

## Purpose

Add an interactive REPL chat mode to the `claw` CLI so users can have multi-turn conversations with coding agents directly in the terminal, using the existing delegate infrastructure (opencode/claude -p) as the execution backend. This replaces the one-shot `claw run` workflow with a persistent session where the first turn runs the full pipeline and follow-up turns go directly to the delegate for fast iteration.

## User Stories

### US-1: Start a Chat Session (P1)

As a developer, I want to type `claw` (no arguments) and land in an interactive chat prompt so that I can have a conversation with the coding agent.

**Acceptance Scenarios:**

- Given I'm in a git repo, When I run `claw`, Then I see a formatted prompt (`claw >`) and can type a message
- Given I'm in a git repo, When I run `claw` and type a prompt, Then the first turn classifies, routes, and runs the full pipeline
- Given I'm in a chat session, When I type a follow-up message, Then it runs as a delegate-only turn (no pipeline overhead)

### US-2: Streaming Output (P1)

As a developer, I want to see the agent's response streaming in real-time with formatted markdown and tool call indicators so that I can follow what the agent is doing.

**Acceptance Scenarios:**

- Given the delegate is running, When it emits text_delta events, Then text streams to stdout with markdown formatting (bold, code blocks with syntax highlight)
- Given the delegate uses a tool, When a tool_use event arrives, Then a collapsed summary line appears (e.g., `[tool] Read(src/foo.ts)`)
- Given the delegate finishes, When session_end arrives, Then a token summary line appears and the prompt returns

### US-3: Slash Commands (P1)

As a developer, I want to type slash commands to control the session without leaving the chat.

**Acceptance Scenarios:**

- Given I'm at the prompt, When I type `/exit`, Then the session ends gracefully
- Given I'm at the prompt, When I type `/status`, Then I see current model, tokens used, complexity, session ID
- Given I'm at the prompt, When I type `/model qwen3-coder-plus`, Then the next turn uses that model
- Given I'm at the prompt, When I type `/delegate`, Then the next turn forces claude -p
- Given I'm at the prompt, When I type `/pipeline`, Then the next turn runs the full pipeline
- Given I'm at the prompt, When I type `/clear`, Then the screen clears but session state remains
- Given I'm at the prompt, When I type `/resume abc-123`, Then the session checkpoint is loaded and the chat continues

### US-4: Session Persistence (P2)

As a developer, I want to be able to resume a previous chat session so that I don't lose context after exiting.

**Acceptance Scenarios:**

- Given I exit a chat with Ctrl+C or `/exit`, When the session had at least one completed turn, Then a session ID is printed for future resume
- Given I have a session ID, When I run `claw --resume <id>`, Then the previous context is loaded and I can continue the conversation
- Given I start a fresh `claw` session, When no `--resume` flag is passed, Then it starts a clean session (ephemeral)

### US-5: Git Branch Management (P2)

As a developer, I want the chat session to manage git branches the same way `claw run` does so that changes are isolated.

**Acceptance Scenarios:**

- Given I start a chat session, When the first pipeline turn succeeds, Then a `claw/<slug>` branch is created from default branch
- Given I'm on a claw branch in a chat, When I send follow-up turns, Then they execute on the same branch
- Given I type `/exit` after changes, When there are commits on the branch, Then it pushes and creates a PR (unless `--no-commit`)

## Functional Requirements

- **FR-001:** `claw` with no arguments MUST enter interactive chat mode
- **FR-002:** `claw "<prompt>"` MUST remain a one-shot run (current behavior preserved)
- **FR-003:** First turn MUST run the full pipeline (classify, route, plan, execute, validate, review) unless `--no-pipeline` is passed
- **FR-004:** Subsequent turns MUST run as delegate-only (spawn opencode/claude -p with the follow-up prompt)
- **FR-005:** The delegate subprocess MUST be spawned fresh for each turn (pipes are one-shot by design)
- **FR-006:** All delegate events (text_delta, tool_use, token_update, session_end) MUST be rendered in the terminal with formatting
- **FR-007:** Tool use events MUST render as a single collapsed line showing tool name and abbreviated input
- **FR-008:** Text output MUST render with basic markdown formatting: **bold**, `inline code`, and fenced code blocks with syntax highlighting
- **FR-009:** A token/cost summary line MUST appear after each turn completes
- **FR-010:** Slash commands MUST be recognized when input starts with `/` — commands: `/exit`, `/status`, `/model <name>`, `/delegate`, `/pipeline`, `/clear`, `/resume <id>`
- **FR-011:** Ctrl+C during a delegate run SHOULD kill the subprocess and return to prompt (not exit the chat)
- **FR-012:** Ctrl+C at an empty prompt MUST exit the chat
- **FR-013:** Session data (turns, tokens, model, branch) MUST be stored in the DB for dashboard visibility
- **FR-014:** On exit, if a branch exists with unpushed commits, the CLI SHOULD offer to push + create PR
- **FR-015:** `/pipeline` MUST set a flag so the next turn runs the full pipeline instead of delegate-only
- **FR-016:** `/delegate` MUST set the provider to `anthropic` (claude -p) for the next turn only
- **FR-017:** Follow-up delegate turns MUST include a context preamble with the original task description and a summary of previous turns so the new subprocess has context

## Non-Functional Requirements

- **NFR-001:** Chat startup (to first prompt) MUST complete in under 500ms (no heavy initialization)
- **NFR-002:** Dependencies: MUST use only Node.js built-in readline + ANSI escapes. No Ink, no blessed, no terminal-kit
- **NFR-003:** Total new code SHOULD be under 1500 LOC (excluding tests)
- **NFR-004:** Markdown rendering MAY use a lightweight library (marked-terminal or similar) if it stays under 50KB

## Out of Scope

- Multiline input editing (paste detection is sufficient for v1)
- Image/file upload to the agent
- Parallel multi-agent execution within a chat session
- Custom themes or color configuration
- Chat history browsing (up-arrow for previous turns — readline handles single-line history only)

## Open Questions

None — all decisions resolved during brainstorming.

# Plan: Pipeline de Fases (Claw Engine)

**Goal:** Add a 5-phase pipeline (PLAN → EXECUTE → VALIDATE → REVIEW → PR) to `claw run` as an opt-in `--pipeline` flag, keeping the existing delegate flow intact.

**Architecture:** Each phase is a pure-ish async function in `src/core/pipeline.ts` that takes inputs and returns structured output. The pipeline orchestrator calls phases sequentially, with VALIDATE→EXECUTE retry loop. All phases emit telemetry events with a `phase` field. The existing `run.ts` gains a `--pipeline` branch that delegates to the orchestrator.

**Tech Stack:** TypeScript ESM, Fastify 5, `claude-pipe.ts` (PLAN/REVIEW), `opencode-pipe.ts` (EXECUTE), `validation-runner.ts` (VALIDATE), `execSync` (PR via `gh`), Vitest for tests.

**REQUIRED SUB-SKILL:** nexus:executing-plans

---

## File Map

| Action | File                               | Purpose                                           |
| ------ | ---------------------------------- | ------------------------------------------------- |
| Create | `src/core/pipeline.ts`             | 5 phase functions + orchestrator                  |
| Modify | `src/cli/commands/run.ts`          | `--pipeline` and `--pr` flags, branch to pipeline |
| Modify | `src/harness/events.ts`            | Add `phase_start` / `phase_end` event types       |
| Create | `tests/unit/core/pipeline.test.ts` | Unit tests for all 5 phases + orchestrator        |

---

## Decisões de design

### Fases como funções com injeção de deps

`execCommand`, `getDiff`, `execGh` são parâmetros opcionais em cada fase para permitir testes sem subprocess. Em produção, cada um tem um default baseado em `execSync`.

### Extensão de HarnessEvent

```
PipelinePhase = "plan" | "execute" | "validate" | "review" | "pr"

phase_start: { type, phase: PipelinePhase, attempt: number }
phase_end:   { type, phase: PipelinePhase, success: boolean, durationMs: number }
```

`validation_result` já existe — reutilizado em `validatePhase`.

### Loop VALIDATE → EXECUTE

- Tentativas: `maxRetries + 1` (primeira + retries).
- Em falha: concatenar saídas dos steps obrigatórios falhos → `previousError` no próximo `executePhase`.
- Ao esgotar tentativas: `runPipeline` retorna `{ executeSuccess: false, ... }` sem entrar em REVIEW/PR.

### PLAN

`runClaudePipe` com `systemPrompt` fixo:

```
You are a planning agent. You have Nexus MCP available.
First call nexus_list to discover available skills.
Then call nexus_get for any relevant skills.
Produce a structured implementation plan based on the skills and the task.
Output ONLY the plan text. No code implementation.
```

### REVIEW

`runClaudePipe` com `systemPrompt` de code reviewer; prompt inclui task original + diff em bloco markdown.

### PR

`gh pr create --title <json> --body <json>` via exec injetável; título = `claw: <prompt[:69]>...` ou `claw: <prompt>` se ≤ 72 chars.

---

## Verificação

```bash
cd ~/server/apps/claw-engine
source ~/.openclaw/secrets/.env
npx tsc --noEmit           # 0 erros
npm test                   # 203 existentes + novos passando
```

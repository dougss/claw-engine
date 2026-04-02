# Spec: Pipeline de Fases

## Goal

Add a 5-phase pipeline (PLAN → EXECUTE → VALIDATE → REVIEW → PR) to `claw run` as an opt-in `--pipeline` flag, keeping the existing delegate flow intact.

## Architecture

Each phase is a pure-ish async function in `src/core/pipeline.ts` that takes inputs and returns structured output. The pipeline orchestrator calls phases sequentially, with a VALIDATE→EXECUTE retry loop. All phases emit telemetry events with a `phase` field. The existing `run.ts` gains a `--pipeline` branch that delegates to the orchestrator.

## Tech Stack

TypeScript ESM, Fastify 5, `claude-pipe.ts` (PLAN/REVIEW), `opencode-pipe.ts` (EXECUTE), `validation-runner.ts` (VALIDATE), `execSync` (PR via `gh`), Vitest for tests.

## User Stories

### US1 — Ativar pipeline na CLI (P1)

**Como** operador,
**quero** passar `--pipeline` em `claw run`,
**para** executar PLAN → EXECUTE → VALIDATE → REVIEW (e PR se `--pr`) em vez do delegate único.

**Critérios de aceite**

- Sem `--pipeline`, o comportamento permanece igual ao atual (classify → route → delegate → commit).
- Com `--pipeline`, as fases rodam na ordem definida.
- Falhas em VALIDATE disparam retry de EXECUTE até `config.validation.max_retries`.

### US2 — Telemetria por fase (P1)

**Como** consumidor do dashboard,
**quero** eventos com identificação de fase (`phase_start`, `phase_end`),
**para** correlacionar logs e duração por etapa.

**Critérios de aceite**

- `HarnessEvent` estendido com `phase_start` e `phase_end`.
- Payloads de telemetria persistidos com `eventType` correspondente.

### US3 — PR opcional (P2)

**Como** operador,
**quero** `--pr` apenas com pipeline,
**para** criar PR via `gh` usando título/body derivados do review.

**Critérios de aceite**

- Sem `--pr`, a fase PR retorna `null` (skip explícito).
- Com `--pr`, usa `gh pr create` com título truncado e body = texto do review.

### US4 — API HTTP inalterada (P1)

**Como** integrador,
**quero** que `POST /api/v1/run` continue funcionando como hoje,
**para** não quebrar clientes existentes.

## Requisitos funcionais

| ID     | Requisito                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| FR-001 | PLAN usa `claude -p` com `systemPrompt` fixo instruindo Nexus (`nexus_list` → `nexus_get` → plano estruturado em markdown).  |
| FR-002 | EXECUTE usa OpenCode com prompt composto de task + plano; em retry inclui saída dos steps falhos como `previousError`.       |
| FR-003 | VALIDATE executa `config.validation.typescript[]` via `runValidation`; default exec = `execSync` capturando stdout/exitCode. |
| FR-004 | REVIEW usa `claude -p` com diff (`git diff HEAD~1`) e `systemPrompt` de code reviewer; produz texto estruturado.             |
| FR-005 | PR via `gh pr create`; ativado apenas com `--pr`; título trunca o prompt em 72 chars; body = texto do review.                |
| FR-006 | Delegate simples e 203+ testes existentes permanecem verdes após a entrega.                                                  |

## Fora de escopo

- Mudar o roteador por complexidade para usar pipeline como default.
- Detecção automática TS vs Python (flag `--lang` ou heurística — follow-up).
- Mudanças na API HTTP `/api/v1/run`.

## Riscos e mitigação

| Risco                                          | Mitigação                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `git diff HEAD~1` inválido sem commit anterior | `getDiff` é injetável nos testes; no fallback de prod, documentar pré-requisito. |
| `gh` não instalado / sem auth                  | Erro isolado na fase PR, fases anteriores não são bloqueadas.                    |
| Testes flaky por spawn real                    | `runClaudePipe` e `runOpencodePipe` são mockados nos unit tests via `vi.mock`.   |

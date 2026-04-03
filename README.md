# Claw Engine

Model-agnostic coding agent factory. Recebe uma descrição de feature, opcionalmente decompõe em DAG de tarefas, **classifica complexidade com um LLM leve (Qwen via Bailian)** e **roteia para o delegate certo**: na prática **OpenCode** (`opencode run --format json`) para trabalho cotidiano e **Claude** (`claude -p`) para tarefas complexas ou fases de planejamento/revisão. Execução é **100% delegate** (subprocessos com ferramentas próprias de cada runtime); não há mais modo “engine” com adapter Alibaba + tools do harness no caminho principal.

Há um **pipeline opcional em cinco fases** (plan → execute → validate → review → PR): PLAN e REVIEW com Claude (+ MCP opcional), EXECUTE com **OpenCode**, validação com os comandos do projeto e abertura de PR via `gh` / GitHub App.

---

## Índice

- [Arquitetura](#arquitetura)
- [Modelo de execução](#modelo-de-execução)
- [Pipeline em fases](#pipeline-em-fases)
- [Instalação e setup](#instalação-e-setup)
- [CLI](#cli)
- [Classificação e roteamento](#classificação-e-roteamento)
- [Ciclo de vida de uma tarefa](#ciclo-de-vida-de-uma-tarefa)
- [Eventos (HarnessEvent)](#eventos-harnessevent)
- [Checkpointing](#checkpointing)
- [Validação](#validação)
- [Dashboard](#dashboard)
- [API REST](#api-rest)
- [SSE / Eventos em tempo real](#sse--eventos-em-tempo-real)
- [Retenção de telemetria](#retenção-de-telemetria)
- [Configuração](#configuração)
- [Banco de dados](#banco-de-dados)
- [Daemon](#daemon)
- [Testes](#testes)
- [Estrutura de diretórios](#estrutura-de-diretórios)

---

## Arquitetura

### Visão macro (work items + DAG)

Fluxo típico de `claw submit` / filas: decomposição em grafo, fila BullMQ, classificação por task, delegate e pós-processamento.

```
┌──────────────┐   submit    ┌─────────────┐   DAG    ┌───────────────┐
│  CLI / API   │────────────▶│ Decomposer  │─────────▶│  Scheduler    │
└──────────────┘             └─────────────┘          │  (BullMQ)     │
                                                       └───────┬───────┘
                                                               │
                                                     ┌─────────▼──────────┐
                                                     │  classifyTask()    │
                                                     │  (Qwen, ~50 tok)   │
                                                     └─────────┬──────────┘
                                                               │
                                                     ┌─────────▼──────────┐
                                                     │      Router        │
                                                     │  chain + complex?  │
                                                     └─────────┬──────────┘
                                              ┌────────────────┴────────────────┐
                                              │                                 │
                                     ┌────────▼─────────┐           ┌──────────▼──────────┐
                                     │  OpenCode        │           │  Claude -p          │
                                     │  opencode run    │           │  stream-json        │
                                     │  simple / medium │           │  complex / fallback │
                                     └────────┬─────────┘           └──────────┬──────────┘
                                              └────────────┬────────────────────┘
                                                           │
                                                  ┌────────▼────────┐
                                                  │  git / worktree │
                                                  │  validação      │
                                                  │  PR (opcional)  │
                                                  └────────┬────────┘
                                                           │
                              ┌────────────────────────────┼────────────────────────────┐
                              │                            │                            │
                     ┌────────▼────────┐        ┌──────────▼──────────┐        ┌──────────▼──────────┐
                     │   PostgreSQL    │        │ Redis + SSE buffer  │        │ Dashboard (React)   │
                     │ work items,     │        │ pub/sub, eventos    │        │ /pipeline, /dag,    │
                     │ telemetria      │        │ em tempo real       │        │ métricas, logs      │
                     └─────────────────┘        └─────────────────────┘        └─────────────────────┘
```

`claw run` (task única) segue o mesmo núcleo **classify → router → OpenCode | Claude** e registra no DB quando possível, mas não passa pelo Decomposer.

### Pipeline opcional (`--pipeline`)

Ativado por `claw run … --pipeline`. O diagrama linear feliz e o **diagrama detalhado com loops** estão na seção [Pipeline em fases](#pipeline-em-fases).

**Stack:**

- Node.js 22, TypeScript ESM, Fastify 5
- BullMQ + Redis (filas por provider)
- PostgreSQL + Drizzle ORM (pgvector/pg16)
- React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts (dashboard)
- **OpenCode** CLI no PATH + **Claude Code** CLI para delegate Anthropic
- Porta: **3004**

---

## Modelo de execução

### Delegate only

Todo trabalho de agente passa por subprocessos:

| Provider     | Quando                         | Como |
| ------------ | ------------------------------ | ---- |
| **OpenCode** | Tarefas `simple` ou `medium` (padrão) | `opencode run … --format json` — stream JSONL mapeado para `HarnessEvent` |
| **Anthropic**| Tarefas `complex` ou fallback na cadeia | `claude -p --output-format stream-json` |

OpenCode e Claude usam **suas próprias ferramentas** (leitura, edição, bash, MCP, etc.). O Claw Engine orquestra, persiste telemetria e expõe SSE no dashboard.

### Classificação (Bailian / DashScope)

`classifyTask()` chama a API compatível com chat completions (`config.providers.alibaba.base_url`, modelo em `models.default`) com prompt fixo e timeout curto (~8s). Saída: `simple` | `medium` | `complex`. Em falha de rede ou API, usa `medium` para não bloquear.

### API Alibaba

A chave e a URL vêm de `config.yaml` (`BAILIAN_SP_API_KEY` e endpoint **coding-intl** no setup atual). OpenCode costuma usar modelos no formato `dashscope/...` conforme `providers.opencode.default_model`.

---

## Pipeline em fases

Com `claw run … --pipeline`, `runPipeline()` em `src/core/pipeline.ts` orquestra fases com eventos `phase_start` / `phase_end` e `validation_result` (dashboard **Pipeline**).

### Diagrama linear (visão feliz)

Caminho sem falhas de validação nem `REQUEST_CHANGES` no review:

```mermaid
flowchart LR
  U["Prompt + repo"] --> P["① PLAN — Claude + MCP"]
  P --> E["② EXECUTE — OpenCode"]
  E --> V["③ VALIDATE"]
  V --> R["④ REVIEW — Claude"]
  R --> G["⑤ PR — git + gh"]
```

### Diagrama completo (loops reais)

Inclui **retry EXECUTE ↔ VALIDATE** quando os testes falham (até `validation.max_retries + 1` tentativas) e **loop de review**: se o veredito for `REQUEST_CHANGES`, volta **EXECUTE → VALIDATE** antes de nova **REVIEW**. Só então, com `--pr`, vem commit/push e `gh pr create` (GitHub App opcional para auth do bot).

```mermaid
flowchart TB
  START([claw run --pipeline])
  FAIL([Pipeline encerra com falha])

  PLAN["PLAN — claude -p + MCP Nexus opcional<br/>saída: plano em texto"]

  subgraph loop_val[Loop EXECUTE ↔ VALIDATE]
    direction TB
    EXEC["EXECUTE — opencode<br/>task + plan + previousError opcional"]
    VAL["VALIDATE — tsc / lint / test"]
    EXEC --> VAL
    VAL -->|"falha, ainda há retry"| EXEC
  end

  subgraph loop_rev[Loop REVIEW]
    direction TB
    REV["REVIEW — claude -p no git diff"]
    FIX["EXECUTE de novo + VALIDATE<br/>com feedback do review"]
    REV -->|"REQUEST_CHANGES"| FIX
    FIX --> REV
  end

  GIT["Commit + push — se --pr"]
  PRN["PR — gh pr create"]
  ENDN([Concluído])

  START --> PLAN --> EXEC
  VAL -->|"passou"| REV
  VAL -->|"esgotou retries"| FAIL
  REV -->|"APPROVE ou max tentativas"| GIT
  GIT --> PRN --> ENDN
```

### Diagrama de sequência (Mermaid)

Substitui o swimlane ASCII: mesmos atores (**Claw Engine**, **Claude** em PLAN e REVIEW, **OpenCode**, **Validador** shell, **Git/gh**). O primeiro diagrama inclui `loop` / `alt` / `opt` alinhados a `runPipeline()`; o segundo é só o **fluxo feliz**.

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant E as "Claw Engine"
  participant PL as "Claude PLAN"
  participant OC as OpenCode
  participant V as "Validador shell"
  participant RV as "Claude REVIEW"
  participant GH as "Git gh"

  U->>E: claw run --pipeline [--pr]
  E->>PL: runClaudePipe PLAN + MCP opcional
  PL-->>E: plano texto

  loop Retries de validação até passar ou esgotar maxRetries+1
    E->>OC: runOpencodePipe EXECUTE task+plan + previousError
    OC-->>E: session_end
    E->>V: runValidation tsc lint test
    V-->>E: passou ou saídas dos steps
  end

  alt validação nunca passou
    E-->>U: pipeline falhou
  else validação passou
    loop Ciclo de review até APPROVE ou maxReviewRetries
      E->>RV: runClaudePipe REVIEW git diff
      RV-->>E: review + veredito
      opt REQUEST_CHANGES
        E->>OC: EXECUTE com feedback do review
        OC-->>E: session_end
        E->>V: VALIDATE
        V-->>E: passou ou falhou
        Note over E: Se validate falhar aqui: aborta com falha.
      end
    end
    E->>GH: commit push gh pr create se --pr
    GH-->>U: URL do PR
  end
```

**Fluxo feliz (sem ramos de retry):**

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant E as "Claw Engine"
  participant PL as "Claude PLAN"
  participant OC as OpenCode
  participant V as "Validador shell"
  participant RV as "Claude REVIEW"
  participant GH as "Git gh"

  U->>E: claw run --pipeline --pr
  E->>PL: PLAN
  PL-->>E: plano
  E->>OC: EXECUTE
  OC-->>E: ok
  E->>V: VALIDATE
  V-->>E: passou
  E->>RV: REVIEW diff
  RV-->>E: APPROVE
  E->>GH: commit push PR
  GH-->>U: URL do PR
```

### Resumo das fases

| # | Fase | Runtime | Entrada principal |
|---|------|---------|-------------------|
| 1 | **PLAN** | `claude -p` + MCP opcional (`config/mcp.json`) | Prompt do usuário; system pede Nexus (`nexus_list` / `nexus_get`) e **só** o plano em texto |
| 2 | **EXECUTE** | `opencode run` | Task + plano colados; se validação ou review falhou, inclui `previousError` |
| 3 | **VALIDATE** | comandos do `validation` no YAML | Worktree do repo |
| 4 | **REVIEW** | `claude -p` | Diff (`git diff HEAD~1` por padrão) + prompt original |
| 5 | **PR** | `git` + `gh` (com `--pr`) | Branch nova se necessário, push, `gh pr create --body` com texto do review; **GitHub App** opcional (`CLAW_GITHUB_*`) |

---

## Instalação e setup

### Pré-requisitos

```bash
docker ps | grep postgres
docker ps | grep redis

# Claude CLI (delegate Anthropic)
claude --version

# OpenCode no PATH
which opencode

# Classificação + provider DashScope no OpenCode
echo $BAILIAN_SP_API_KEY
```

### Instalar

```bash
cd ~/server/apps/claw-engine
npm install
npm link

which claw
claw --version
```

### Banco de dados

```bash
docker exec postgres psql -U admin -d postgres -c "
  CREATE ROLE claw_engine WITH LOGIN PASSWORD 'claw_engine_local' CREATEDB;
  CREATE DATABASE claw_engine OWNER claw_engine;
"

cd ~/server/apps/claw-engine
npx drizzle-kit migrate
```

### Variáveis de ambiente

```bash
export CLAW_ENGINE_DB_PASS=claw_engine_local
export BAILIAN_SP_API_KEY=sk-...
export CLAW_ENGINE_DATABASE_URL=postgresql://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine

# Opcional: pipeline com PR atribuída ao bot
# export CLAW_GITHUB_APP_ID=...
# export CLAW_GITHUB_INSTALLATION_ID=...
# export CLAW_GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/app.pem
```

### Daemon (LaunchAgent)

```bash
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist
launchctl list | grep claw-engine
tail -f ~/server/logs/claw-engine.log
```

---

## CLI

### `claw doctor`

Config, Postgres, Redis, binário `claude`, espaço em disco.

```bash
claw doctor
```

---

### `claw run <repo> <prompt>`

- **Repo** pode ser um caminho local ou `owner/repo` do GitHub (clone em `/tmp/claw-runs/…`).
- **Classificação** automática + roteamento OpenCode vs Claude.
- **`--delegate`** força Claude.
- **`--pipeline`** ativa PLAN → EXECUTE (OpenCode) → VALIDATE → REVIEW → (PR se `--pr`).
- **`--no-commit`** evita commit automático após run simples (pipeline com `--pr` gerencia git internamente).

```bash
claw run . "corrigir typo no README"
claw run dougss/finno "adicionar campo created_at" --delegate
claw run . "feature X" --pipeline
claw run . "feature X" --pipeline --pr
claw run . "teste" --dry-run
```

---

### `claw submit`, `status`, `sessions`, `logs`, `costs`, `router-stats`, `cleanup`, `daemon`, `pause`, `resume`, `cancel`, `retry`, `approve`

Comportamento geral igual à versão anterior (filas, DAG, work items). Estatísticas de roteamento refletem providers **opencode** vs **anthropic**.

---

## Classificação e roteamento

1. **`fallbackChainPosition > 0`** — usa o tier correspondente da `fallback_chain` (escalonamento após falha).
2. **`complexity === "complex"`** — preferência por tier **anthropic** na cadeia, se existir.
3. **Caso contrário** — tier **opencode** na cadeia (`simple`/`medium`).

Cadeia típica em `config/config.yaml`:

```yaml
models:
  default: "qwen3-coder-plus"   # só classificação
  fallback_chain:
    - { model: "opencode-default", provider: "opencode", mode: "delegate", max_retries: 2 }
    - { model: "claude-sonnet", provider: "anthropic", mode: "delegate", max_retries: 1 }
```

---

## Ciclo de vida de uma tarefa

```
queued
  └─▶ provisioning    (criar git worktree)
        └─▶ starting  (iniciar sessão)
              └─▶ running
                    ├─▶ checkpointing    (limite de contexto, quando aplicável)
                    ├─▶ validating       (tsc, lint, tests)
                    │     └─▶ needs_human_review
                    ├─▶ completed
                    ├─▶ failed
                    ├─▶ interrupted
                    └─▶ stalled
```

Estados especiais: `blocked`, `merging_dependency`, `needs_human_review` (após falha de validação, se configurado).

---

## Eventos (HarnessEvent)

Além de `session_start`, `text_delta`, `tool_use`, `tool_result`, `token_update`, `session_end`, etc., o engine emite:

- **`phase_start` / `phase_end`** — fases do pipeline (`plan` | `execute` | `validate` | `review` | `pr`).
- **`validation_result`** — passo a passo da validação com tempos.

Fluxo típico no delegate: adapter faz streaming do subprocesso → eventos unificados para telemetria e SSE.

---

## Checkpointing

Quando o runtime reporta uso alto de contexto (conforme adapter e `token_budget` no config), pode ocorrer checkpoint com resumo para continuar em nova sessão. Comportamento exato depende do provider (Claude vs OpenCode).

---

## Validação

Após a sessão (ou na fase VALIDATE do pipeline), rodam os comandos definidos em `config.yaml` para TypeScript e/ou Python. Steps obrigatórios vs opcionais e `max_retries` controlam re-tentativas antes de falha humana.

---

## Dashboard

**http://192.168.1.100:3004** (ou `localhost:3004`)

| Página    | URL          | Função |
| --------- | ------------ | ------ |
| Pipeline  | `/pipeline`  | Timeline das fases PLAN → … → PR; rota inicial padrão |
| DAG       | `/dag`       | Grafo de tasks (React Flow) |
| Sessions  | `/sessions`  | Tasks ativas |
| Metrics   | `/metrics`   | Status, tokens, custo (inclui cor/provider OpenCode) |
| Logs      | `/logs`      | Telemetria em tempo real |

---

## API REST

Base: **`http://localhost:3004/api/v1`**

| Método | Endpoint | Descrição |
| ------ | -------- | --------- |
| GET    | `/health` | Health check |
| GET    | `/work-items` | Lista work items |
| GET    | `/work-items/:id` | Detalhe + tasks |
| GET    | `/tasks/:id` | Task + telemetria |
| GET    | `/sessions` | Sessões ativas |
| GET    | `/metrics` | Métricas agregadas |
| GET    | `/logs` | Logs / eventos |
| GET    | `/events` | SSE global |
| POST   | `/run` | Submeter run remoto (`repo`, `prompt`, `model` opcional) |
| GET    | `/tasks/:id/stream` | SSE por task |

Exemplo:

```bash
curl -X POST http://127.0.0.1:3004/api/v1/run \
  -H "Content-Type: application/json" \
  -d '{"repo":"/caminho/absoluto/repo","prompt":"sua tarefa"}'
```

---

## SSE / Eventos em tempo real

`GET /api/v1/events` — broadcast global. Reconexão com header `Last-Event-ID` e buffer Redis (replay).

Streams por task: ver `GET /api/v1/tasks/:id/stream` na resposta do `POST /run`.

---

## Retenção de telemetria

```yaml
cleanup:
  telemetry_heartbeat_retention_days: 14
  telemetry_events_retention_days: 90
```

`claw cleanup` aplica política manualmente; o daemon também reconcilia worktrees.

---

## Configuração

Arquivo: `config/config.yaml` (override: `CLAW_ENGINE_CONFIG`).

Pontos importantes:

- **`providers.opencode`**: `binary` (default `opencode`), `default_model` (ex.: `dashscope/qwen3-coder-plus`).
- **`providers.anthropic`**: `binary`, `flags`, limites e `force_qwen_percent` (pressão de orçamento legada; roteamento principal é classificador + chain).
- **`providers.alibaba`**: chave (`api_key_env`), `base_url` para classificação.
- **`mcp`**: servidores MCP opcionais; herança de arquivo externo via `inherit_from`.
- **`github`**: `GITHUB_TOKEN`, org padrão, `auto_create_pr`.
- **`notifications.telegram`**: via OpenClaw se habilitado.

---

## Banco de dados

PostgreSQL `claw_engine` em `127.0.0.1:5432`. Tabelas principais: `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`. Ver código em `src/storage/schema/`.

---

## Daemon

Sobe Fastify na porta configurada, reconcilia worktrees ao iniciar, mantém filas BullMQ e conexão Redis. LaunchAgent: `~/Library/LaunchAgents/dev.claw-engine.server.plist`, logs em `~/server/logs/claw-engine.log`.

---

## Testes

```bash
npm test
npm run test:integration   # Postgres + Redis
npm run test:watch
```

---

## Estrutura de diretórios (resumo)

```
claw-engine/
├── bin/claw.js
├── config/config.yaml
├── config/mcp.json
├── src/
│   ├── api/routes/          # work-items, tasks, run-api, metrics, logs, sessions, stats
│   ├── cli/commands/
│   ├── core/
│   │   ├── classifier.ts   # LLM complexity
│   │   ├── pipeline.ts     # fases PLAN…PR
│   │   ├── router.ts
│   │   ├── scheduler.ts
│   │   └── …
│   ├── harness/
│   │   ├── events.ts
│   │   └── model-adapters/  # opencode-pipe-adapter, claude-pipe, …
│   ├── integrations/
│   │   ├── opencode/opencode-pipe.ts
│   │   ├── claude-p/
│   │   ├── github/
│   │   └── openclaw/
│   ├── dashboard/src/       # React (pipeline, dag, sessions, metrics, logs)
│   └── …
├── tests/unit|integration/
└── migrations/
```

---

## Licença / projeto

`private` — uso interno no Mac Mini server (`CLAUDE.md` na raiz `~/server`).

# Claw Engine

Model-agnostic coding agent factory. Recebe uma descrição de feature, cria um grafo de dependências (DAG) de tarefas, roteia cada tarefa para o modelo mais adequado (Alibaba/Qwen em Engine Mode ou Claude em Delegate Mode), executa em git worktrees isolados e abre PRs automaticamente.

---

## Índice

- [Arquitetura](#arquitetura)
- [Modos de execução](#modos-de-execução)
- [Instalação e setup](#instalação-e-setup)
- [CLI](#cli)
- [Roteamento de modelos](#roteamento-de-modelos)
- [Ciclo de vida de uma tarefa](#ciclo-de-vida-de-uma-tarefa)
- [Agent Loop](#agent-loop)
- [Checkpointing](#checkpointing)
- [Permissões de ferramentas](#permissões-de-ferramentas)
- [Validação](#validação)
- [Dashboard](#dashboard)
- [API REST](#api-rest)
- [SSE / Eventos em tempo real](#sse--eventos-em-tempo-real)
- [Retenção de telemetria](#retenção-de-telemetria)
- [Configuração](#configuração)
- [Banco de dados](#banco-de-dados)
- [Daemon](#daemon)
- [Testes](#testes)

---

## Arquitetura

```
┌──────────────┐   submit    ┌─────────────┐   DAG    ┌───────────────┐
│  CLI / API   │────────────▶│  Decomposer │─────────▶│   Scheduler   │
└──────────────┘             └─────────────┘          │  (BullMQ)     │
                                                       └───────┬───────┘
                                                               │ enqueue
                                                     ┌─────────▼──────────┐
                                                     │      Router        │
                                                     │  (3-layer logic)   │
                                                     └─────────┬──────────┘
                                              ┌────────────────┴────────────────┐
                                              │                                 │
                                     ┌────────▼─────────┐           ┌──────────▼──────────┐
                                     │  Engine Mode      │           │  Delegate Mode       │
                                     │  Alibaba/Qwen     │           │  claude -p           │
                                     │  Harness tools    │           │  Claude's own tools  │
                                     └────────┬─────────┘           └──────────┬──────────┘
                                              └────────────┬────────────────────┘
                                                           │
                                                  ┌────────▼────────┐
                                                  │   Agent Loop    │
                                                  │  git worktree   │
                                                  │  validação      │
                                                  │  PR automático  │
                                                  └─────────────────┘
```

**Stack:**

- Node.js 22, TypeScript ESM, Fastify 5
- BullMQ + Redis (filas por provider)
- PostgreSQL + Drizzle ORM (pgvector/pg16)
- React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts (dashboard)
- Porta: **3004**

---

## Modos de execução

### Engine Mode (Alibaba/Qwen)

- Adapter OpenAI-compatible via DashScope API
- Tools gerenciadas pelo harness: `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `ask_user`
- Concorrência: 3 sessões paralelas
- Custo: baixo (~gratuito com tier DashScope)
- Ideal para: tasks simples, boilerplate, CRUD, renomeações

### Delegate Mode (Anthropic/Claude)

- Subprocess `claude -p --output-format stream-json --verbose`
- Claude Code usa suas próprias ferramentas (total autonomia)
- Concorrência: 1 sessão paralela (caro)
- Custo: $3/$15 por 1M tokens (input/output)
- Ideal para: tasks complexas, refactor, debug, arquitetura

---

## Instalação e setup

### Pré-requisitos

```bash
# Docker rodando (postgres + redis)
docker ps | grep postgres
docker ps | grep redis

# Claude CLI instalado e autenticado
claude --version

# DASHSCOPE_API_KEY (para Engine Mode com Alibaba)
echo $DASHSCOPE_API_KEY
```

### Instalar

```bash
cd ~/server/apps/claw-engine
npm install

# Instalar claw globalmente
npm link

# Verificar
which claw      # → /opt/homebrew/bin/claw
claw --version  # → 0.1.0
```

### Banco de dados

```bash
# Criar DB e usuário (se não existir)
docker exec postgres psql -U admin -d postgres -c "
  CREATE ROLE claw_engine WITH LOGIN PASSWORD 'claw_engine_local' CREATEDB;
  CREATE DATABASE claw_engine OWNER claw_engine;
"

# Rodar migrations
cd ~/server/apps/claw-engine
npx drizzle-kit migrate
```

### Variáveis de ambiente

```bash
# Opcional — sem isso o CLI usa "claw_engine_local" como senha padrão
export CLAW_ENGINE_DB_PASS=claw_engine_local

# Para Engine Mode
export DASHSCOPE_API_KEY=sk-...

# Para override completo da connection string
export CLAW_ENGINE_DATABASE_URL=postgresql://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine
```

### Daemon (LaunchAgent)

```bash
# Carregar (auto-start no boot)
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist

# Status
launchctl list | grep claw-engine

# Logs
tail -f ~/server/logs/claw-engine.log
```

---

## CLI

O binário `claw` é instalado globalmente e funciona a partir de qualquer diretório.

### `claw doctor`

Verifica o ambiente antes de usar.

```bash
claw doctor
```

Checagens realizadas:

| Check         | Método             | Falha se              |
| ------------- | ------------------ | --------------------- |
| Config        | loadConfig() / Zod | YAML inválido         |
| Database      | SELECT 1           | Postgres indisponível |
| Redis         | PING               | Redis indisponível    |
| Claude binary | `which claude`     | claude não no PATH    |
| Disk space    | statfs("/")        | < 20 GB livres        |

---

### `claw run <repo> <prompt>`

Executa uma tarefa diretamente em um repositório. Ideal para testar rapidamente.

```bash
# Usar roteamento automático (router decide engine ou delegate)
claw run . "refatorar o módulo de auth"

# Forçar Delegate Mode (Claude CLI)
claw run . "listar todos os arquivos de teste" --delegate

# Forçar modelo específico
claw run ~/server/apps/nexus "adicionar campo created_at" --delegate --model claude-opus-4-6

# Dry-run (ver o que seria feito sem executar)
claw run . "refatorar função X" --dry-run
```

O prompt é resolvido relativo ao diretório atual — funciona igual ao `claude code`.

**Saída em tempo real:**

- Texto do agente: stdout
- Tool calls, tokens, status: stderr (não polui pipes)

---

### `claw submit <description>`

Submete um work item completo (pode ter múltiplas tasks em DAG) para a fila.

```bash
claw submit "implementar sistema de notificações com email e push"
claw submit "refatorar módulo de pagamentos" --repos ~/server/apps/finno
```

O Decomposer usa LLM para quebrar a descrição em tasks com dependências.

---

### `claw status [work-item-id]`

```bash
claw status                  # todos os work items
claw status abc123           # work item específico
```

---

### `claw sessions`

Lista sessões ativas (tasks em status running/starting/provisioning).

```bash
claw sessions
```

---

### `claw logs [task-id]`

```bash
claw logs                    # logs gerais do engine
claw logs abc123             # logs de uma task específica
claw logs --level debug      # filtrar por nível
claw logs --search "error"   # buscar texto
```

---

### `claw costs [--days N]`

```bash
claw costs           # últimos 7 dias
claw costs --days 30
```

---

### `claw router-stats`

Estatísticas de roteamento: quantas tasks foram para engine vs delegate, motivos de decisão.

```bash
claw router-stats
```

---

### `claw cleanup [--dry-run]`

Remove worktrees órfãos e telemetria antiga conforme política de retenção.

```bash
claw cleanup           # executar limpeza
claw cleanup --dry-run # ver o que seria removido
```

---

### `claw daemon <action>`

```bash
claw daemon start    # iniciar via LaunchAgent
claw daemon stop     # parar
claw daemon status   # ver estado
```

---

### Controle de work items

```bash
claw pause <work-item-id>    # pausar execução
claw resume <work-item-id>   # retomar
claw cancel <work-item-id>   # cancelar
claw retry <task-id>         # repetir task falha
claw approve <work-item-id>  # aprovar review pendente
```

---

## Roteamento de modelos

O router usa uma árvore de decisão de 3 camadas para enviar cada task para o modelo mais barato capaz de realizá-la.

```
RouteInput
  ├── complexity: "simple" | "medium" | "complex"
  ├── description: string
  ├── fallbackChainPosition: number
  └── claudeBudgetPercent: number
         │
         ▼
┌────────────────────────────────┐
│  1. Fallback chain position?   │ → se > 0, usar tier N da chain
└────────────────────────────────┘
         │ não
         ▼
┌────────────────────────────────┐
│  2. Claude budget >= 85%?      │ → forçar Alibaba/Qwen
└────────────────────────────────┘
         │ não
         ▼
┌────────────────────────────────┐
│  3a. complexity == "complex"?  │ → Delegate (Claude)
│  3b. complexity == "simple"?   │ → Engine (Qwen)
│  3c. medium: keyword score     │
└────────────────────────────────┘
         │
         ▼
    Keyword scoring
    (positivo → Delegate, negativo → Engine)
```

### Sinais de complexidade (padrão)

| Keyword           | Score | Efeito   |
| ----------------- | ----- | -------- |
| `cross-repo`      | +4    | Delegate |
| `refactor`        | +3    | Delegate |
| `debug`           | +3    | Delegate |
| `architecture`    | +3    | Delegate |
| `investigate`     | +2    | Delegate |
| `migration`       | +2    | Delegate |
| `security`        | +2    | Delegate |
| `test`            | -1    | Engine   |
| `crud`            | -2    | Engine   |
| `rename`          | -2    | Engine   |
| `add field`       | -2    | Engine   |
| `create endpoint` | -1    | Engine   |
| `boilerplate`     | -3    | Engine   |

### Fallback chain (padrão)

```yaml
models:
  fallback_chain:
    - model: qwen3.5-plus # tier 0: Engine (barato)
      provider: alibaba
      mode: engine
    - model: deepseek-v3 # tier 1: Engine (fallback)
      provider: alibaba
      mode: engine
    - model: claude-sonnet # tier 2: Delegate (premium)
      provider: anthropic
      mode: delegate
```

Se uma task falha, sobe para o próximo tier (se `escalate_model_on_retry: true`).

---

## Ciclo de vida de uma tarefa

```
queued
  └─▶ provisioning    (criar git worktree)
        └─▶ starting  (iniciar sessão)
              └─▶ running
                    ├─▶ checkpointing    (token limite atingido)
                    │     └─▶ resuming   (nova sessão com checkpoint)
                    │           └─▶ running
                    ├─▶ validating       (tsc, lint, tests)
                    │     └─▶ needs_human_review  (validação falhou)
                    ├─▶ completed
                    ├─▶ failed
                    ├─▶ interrupted      (daemon reiniciado)
                    └─▶ stalled          (sem progresso)
```

**Estados especiais:**

- `blocked` — aguardando tarefa dependente no DAG
- `merging_dependency` — integrando resultado de tarefa dependente
- `needs_human_review` — validação falhou, aguarda `claw approve`

---

## Agent Loop

O loop principal em `src/harness/agent-loop.ts` é um gerador assíncrono que emite `HarnessEvent`:

```typescript
type HarnessEvent =
  | { type: "session_start"; sessionId: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "token_update"; used: number; budget: number; percent: number }
  | { type: "checkpoint"; reason: "token_limit" | "stall" | "manual" }
  | {
      type: "session_end";
      reason: "completed" | "checkpoint" | "error" | "max_iterations";
    };
```

**Fluxo por iteração:**

```
1. adapter.chat(messages)          → stream de eventos
2. acumular text_delta
3. tool_use recebido:
     a. evaluatePermission()        → allow / deny
     b. se deny → permission_denied + error na conversa
     c. getTool(name) ou MCP        → ToolHandler
     d. executar com workspacePath
     e. emitir tool_result
4. verificar token % >= threshold   → checkpoint
5. se sem tool_use → session_end("completed")
6. senão: loop (até maxIterations)
```

---

## Checkpointing

Quando o uso de tokens atinge 85% do contexto (configurável):

1. Injeta `SUMMARY_PROMPT` na conversa
2. Chama o modelo para produzir um resumo compacto
3. Emite `checkpoint` + `session_end(reason: "checkpoint")`
4. Salva `checkpointData` na task (DB)

**Resumo injeta no sistema da próxima sessão:**

```json
{
  "summary": "...",
  "recentMessages": [...]
}
```

A nova sessão começa com o contexto do checkpoint e continua naturalmente.

---

## Permissões de ferramentas

Regras avaliadas por `evaluatePermission()`:

| Ferramenta   | Default | Restrição                       |
| ------------ | ------- | ------------------------------- |
| `read_file`  | allow   | -                               |
| `glob`       | allow   | -                               |
| `grep`       | allow   | -                               |
| `ask_user`   | allow   | -                               |
| `write_file` | allow   | apenas dentro do workspacePath  |
| `edit_file`  | allow   | apenas dentro do workspacePath  |
| `bash`       | allow   | comandos destrutivos bloqueados |

**Comandos bash bloqueados:**

- `rm -rf`, `git push --force`, `mkfs`, `DROP TABLE`
- Qualquer comando fora do workspacePath

Ao negar: emite `permission_denied` + injeta mensagem de erro na conversa para o agente tentar outra abordagem.

---

## Validação

Após a sessão completar, roda validação automática no worktree.

**TypeScript:**

```bash
npx tsc --noEmit    # obrigatório, retryable
npm run lint         # opcional, retryable
npm test             # obrigatório, retryable
```

**Python:**

```bash
mypy .               # opcional
ruff check .         # opcional
pytest               # obrigatório
```

- Steps obrigatórios: falha bloqueia completion
- Steps opcionais: falha é registrada mas não bloqueia
- `max_retries: 2` — tenta corrigir automaticamente antes de ir para `needs_human_review`

---

## Dashboard

Acesso: **http://192.168.1.100:3004**

| Página   | URL         | Função                                                                                                                                        |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DAG View | `/dag`      | Grafo de tasks com ReactFlow. Cor por status: verde=completed, azul=running, vermelho=failed, cinza=pending. Selecionar WorkItem no dropdown. |
| Sessions | `/sessions` | Tasks ativas (running/starting/provisioning) com status em tempo real.                                                                        |
| Metrics  | `/metrics`  | Gráfico de barras (distribuição de status), total de tokens e custo USD.                                                                      |
| Logs     | `/logs`     | Log viewer em tempo real. Filtro por task ID. Pausar/retomar scroll.                                                                          |

**Tech stack:** React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts

---

## API REST

Base: `http://localhost:3004/api`

| Método | Endpoint          | Descrição                                 |
| ------ | ----------------- | ----------------------------------------- |
| GET    | `/work-items`     | Listar todos os work items                |
| GET    | `/work-items/:id` | Work item por ID com tasks                |
| GET    | `/tasks/:id`      | Task por ID com telemetria                |
| GET    | `/sessions`       | Tasks ativas                              |
| GET    | `/metrics`        | Estatísticas (status, tokens, custo)      |
| GET    | `/logs`           | Eventos de telemetria (filtro por taskId) |
| GET    | `/events`         | SSE stream                                |

**Exemplo: submeter via API**

```bash
curl -X POST http://192.168.1.100:3004/api/work-items \
  -H "Content-Type: application/json" \
  -d '{"title":"minha feature","repos":["/caminho/no/mini"]}'
```

---

## SSE / Eventos em tempo real

Endpoint: `GET /api/events`

Eventos emitidos em tempo real para o dashboard e qualquer cliente SSE:

```
id: 42
event: task_status_changed
data: {"taskId":"abc","status":"running","model":"qwen3.5-plus"}

id: 43
event: text_delta
data: {"taskId":"abc","text":"Analisando o código..."}
```

**Reconexão com replay:**

- Enviar header `Last-Event-ID: N` na reconexão
- Buffer circular (500 eventos) no Redis garante replay

**Keep-alive:** ping a cada 15 segundos para manter conexão aberta.

---

## Retenção de telemetria

```yaml
cleanup:
  telemetry_heartbeat_retention_days: 14 # heartbeats
  telemetry_events_retention_days: 90 # outros eventos
  # cost_snapshot: preservado para sempre
```

Aplicar manualmente: `claw cleanup`
Limpeza automática: no boot do daemon + após merge de PR.

---

## Configuração

Arquivo: `config/config.yaml`

```yaml
engine:
  name: "Claw Engine"
  port: 3004
  host: "0.0.0.0"
  worktrees_dir: "~/server/.worktrees"

database:
  host: "127.0.0.1"
  port: 5432
  database: "claw_engine"
  user: "claw_engine"
  password_env: "CLAW_ENGINE_DB_PASS" # env var com a senha

redis:
  host: "127.0.0.1"
  port: 6379

providers:
  alibaba:
    api_key_env: "DASHSCOPE_API_KEY"
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    rate_limit:
      max_requests_per_minute: 8
  anthropic:
    binary: "claude"
    estimated_daily_limit: 500000 # tokens/dia
    warning_percent: 0.70 # avisar ao atingir 70%
    force_qwen_percent: 0.85 # forçar Qwen ao atingir 85%

router:
  complexity_signals:
    refactor: 3
    debug: 3
    architecture: 3
    # ... ver seção Roteamento

sessions:
  max_parallel: 3
  max_parallel_engine: 3
  max_parallel_delegate: 1 # Claude é caro, 1 por vez

token_budget:
  warning_threshold: 0.75
  checkpoint_threshold: 0.85 # checkpoint ao atingir 85%
  reserve_for_summary: 10000 # tokens reservados para resumo

github:
  token_env: "GITHUB_TOKEN"
  default_org: "dougss"
  auto_create_pr: true
```

---

## Banco de dados

PostgreSQL `claw_engine` (127.0.0.1:5432) — 5 tabelas:

### `work_items`

| Coluna                       | Tipo          | Descrição                                 |
| ---------------------------- | ------------- | ----------------------------------------- |
| id                           | uuid PK       | -                                         |
| title, description           | varchar, text | -                                         |
| source                       | varchar       | "cli", "github", "api"                    |
| status                       | varchar       | queued/running/completed/failed/cancelled |
| priority                     | int           | 1-5, default 3                            |
| dag                          | jsonb         | WorkItemDAG completo                      |
| total_tokens_used            | bigint        | acumulado                                 |
| total_cost_usd               | numeric       | acumulado                                 |
| tasks_total, tasks_completed | int           | progresso                                 |

### `tasks`

| Coluna                       | Tipo                  | Descrição                   |
| ---------------------------- | --------------------- | --------------------------- |
| id                           | uuid PK               | -                           |
| work_item_id                 | uuid FK               | → work_items                |
| dag_node_id                  | varchar               | ID dentro do DAG            |
| repo, branch                 | varchar               | `claw/<task-id>`            |
| worktree_path                | varchar               | `~/server/.worktrees/<id>`  |
| status                       | varchar               | 14 estados possíveis        |
| model, mode                  | varchar               | routed model & mode         |
| fallback_chain_position      | int                   | posição atual na chain      |
| attempt, max_attempts        | int                   | retries                     |
| last_error, error_class      | text, varchar         | falha atual                 |
| tokens_used, cost_usd        | bigint, numeric       | custo da task               |
| checkpoint_data              | jsonb                 | dados do último checkpoint  |
| validation_results           | jsonb                 | resultado de tsc/lint/tests |
| pr_url, pr_number, pr_status | varchar, int, varchar | PR no GitHub                |

### `session_telemetry`

Todos os eventos do agent loop: tool_use, text_delta, checkpoint, heartbeat, etc.

### `routing_history`

Decisões de roteamento para o learning loop (ajuste estatístico de scores).

### `cost_snapshots`

Snapshots acumulados de custo por work item. Preservados para sempre.

---

## Daemon

`src/daemon.ts` — processo que roda o servidor HTTP + orquestra o Scheduler.

**Na inicialização:**

1. Carregar config
2. Conectar Redis
3. **Reconciliação:**
   - Listar dirs em `~/server/.worktrees/`
   - Verificar quais IDs estão ativos no DB
   - Remover dirs órfãos (no disco mas não no DB)
   - Re-enfileirar tasks que estavam `running` quando o daemon morreu → marcar como `interrupted`
4. Iniciar Fastify na porta 3004
5. SIGTERM/SIGINT: fechar Fastify → Redis → DB → exit

**LaunchAgent:** `~/Library/LaunchAgents/dev.claw-engine.server.plist`

- KeepAlive: sim (auto-restart em crash)
- Logs: `~/server/logs/claw-engine.log`

---

## Testes

```bash
# Unit tests (sem infra)
npm test

# Integration tests (requer Postgres + Redis)
npm run test:integration

# Watch mode
npm run test:watch

# Limpar dados de testes do banco
docker exec postgres psql -U claw_engine -d claw_engine -c "TRUNCATE work_items CASCADE;"
```

**Suites:**

| Arquivo                                  | Tipo        | Cobre                                  |
| ---------------------------------------- | ----------- | -------------------------------------- |
| `config.test.ts`                         | Unit        | Parsing e validação do YAML            |
| `core/router.test.ts`                    | Unit        | Lógica de roteamento e keyword scoring |
| `core/retention.test.ts`                 | Unit        | Política de retenção de telemetria     |
| `core/learning-loop.test.ts`             | Unit        | Cálculo de success rates               |
| `core/dag-schema.test.ts`                | Unit        | Validação do schema Zod                |
| `harness/agent-loop.test.ts`             | Unit        | Loop com mock adapter                  |
| `harness/permissions.test.ts`            | Unit        | Avaliação de permissões                |
| `harness/checkpoint.test.ts`             | Unit        | Lógica de checkpoint                   |
| `integrations/claude-pipe-parse.test.ts` | Unit        | Parser do stream-json                  |
| `storage-repos.test.ts`                  | Integration | CRUD no banco real                     |
| `scheduler.test.ts`                      | Integration | Orquestração BullMQ + Redis            |
| `api.test.ts`                            | Integration | Endpoints REST                         |
| `reconcile.test.ts`                      | Integration | Reconciliação de worktrees             |

---

## Estrutura de diretórios

```
claw-engine/
├── bin/
│   └── claw.js                    # Binário global (npm link)
├── config/
│   └── config.yaml                # Configuração principal
├── src/
│   ├── api/
│   │   ├── routes/                # work-items, tasks, logs, metrics, sessions
│   │   └── sse.ts                 # SSE + Redis pub/sub + circular buffer
│   ├── cli/
│   │   ├── commands/              # 15 comandos CLI
│   │   └── index.ts               # Commander.js
│   ├── core/
│   │   ├── dag-schema.ts          # WorkItemDAG Zod schemas
│   │   ├── decomposer.ts          # LLM feature → DAG
│   │   ├── error-classifier.ts    # Classificação de erros para retry
│   │   ├── health-monitor.ts      # Health checks de sessão
│   │   ├── learning-loop.ts       # Router feedback loop
│   │   ├── reconcile.ts           # Startup: orphan cleanup + requeue
│   │   ├── retention.ts           # Política de retenção de telemetria
│   │   ├── router.ts              # Roteamento 3-layer
│   │   ├── scheduler.ts           # BullMQ DAG orchestration
│   │   ├── session-manager.ts     # Ciclo de vida de sessão
│   │   ├── state-machine.ts       # Transições de estado
│   │   └── validation-runner.ts   # tsc, lint, tests
│   ├── daemon.ts                  # Entry point do servidor
│   ├── harness/
│   │   ├── agent-loop.ts          # Loop principal de streaming
│   │   ├── context-builder.ts     # System/user prompt
│   │   ├── events.ts              # HarnessEvent types
│   │   ├── model-adapters/
│   │   │   ├── alibaba-adapter.ts # DashScope/OpenAI-compatible
│   │   │   ├── claude-pipe-adapter.ts  # `claude -p` subprocess
│   │   │   └── mock-adapter.ts    # Para testes
│   │   ├── permissions.ts         # Tool permission rules
│   │   ├── token-budget.ts        # Tracking de contexto
│   │   └── tools/
│   │       ├── builtins/          # bash, read, write, edit, glob, grep, ask_user
│   │       ├── tool-registry.ts
│   │       └── tool-types.ts
│   ├── integrations/
│   │   ├── claude-p/              # runClaudePipe + parseClaudeLine
│   │   ├── git/                   # Worktree operations
│   │   ├── github/                # PR creation
│   │   ├── mcp/                   # MCP client
│   │   └── openclaw/              # OpenClaw notifications
│   ├── server.ts                  # Fastify setup + dashboard estático
│   ├── storage/
│   │   ├── db.ts                  # Drizzle ORM singleton
│   │   ├── repositories/          # work-items, tasks, telemetry, cost, routing
│   │   └── schema/                # 5 tabelas Drizzle
│   ├── dashboard/                 # React app (src/dashboard/)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── lib/api.ts         # fetch helpers
│   │       ├── lib/sse.ts         # EventSource + auto-reconnect
│   │       └── pages/             # dag, sessions, metrics, logs
│   └── config-schema.ts           # Zod config schema
├── tests/
│   ├── unit/
│   └── integration/
├── migrations/
├── dist/                          # Build output
│   └── dashboard/                 # React build (Vite outDir)
└── package.json
```

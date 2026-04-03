# Research Report: Claw Engine Dashboard Redesign

Data: 2026-04-03

## 1. Estado Atual (Screenshots)

5 telas em `screenshots/`. Dark theme com tons de cyan/teal. Sidebar + content area.

### Problemas Identificados

**Pipeline (home):** Lista de work items no lado esquerdo, detail pane direito com "Phase Timeline", "Plan", "Execution Logs" — tudo vazio/placeholder. Layout splitado mas o detail pane nao mostra nada util. Cards de task sao densos demais e todos parecem iguais.

**DAG:** Pagina quase vazia. Dropdown para selecionar work item, empty state grande. Sem contexto — usuario nao sabe o que esperar.

**Executions:** Cards empilhados verticalmente com titulo + descricao + provider + status badge. Muita repeticao visual. Nao tem filtragem nem busca. Todos os cards parecem identicos a nao ser pelo badge de status.

**Metrics:** 5 KPI cards no topo (total tasks, active, tokens, cost, errors) + chart de barras "Task Distribution" + progress bar "Completion Rate". Razoavel mas os KPI cards sao grandes demais para a informacao que mostram. Chart de barras tem uma unica barra. Nao tem trends.

**Logs:** Tabela de telemetry com timestamp + tipo + JSON data. Funcional mas raw demais — dump de JSON sem formatacao. Nao tem filtering real-time util.

### Diagnostico Geral

- **Muitas paginas para pouca informacao** — 5 tabs mas o usuario quer ver 2 coisas: "o que esta rodando" e "o que terminou"
- **Detail pane vazio** — a pipeline view tem um detail pane mas ele nao mostra nada util
- **Sem acao primaria visivel** — nao existe botao de "New Task" ou submit
- **Executions e Pipeline sao redundantes** — mostram a mesma data de angulos diferentes
- **Logs sao raw JSON** — nao tem formatacao semantica por tipo de evento
- **DAG e uma feature sem uso** — 99% das tasks sao single-node, o DAG viewer e premature

## 2. API Backend (Inventario Completo)

### REST Endpoints

| Method | Path                       | Descricao                                 |
| ------ | -------------------------- | ----------------------------------------- |
| GET    | `/api/v1/health`           | Health check                              |
| POST   | `/api/v1/run`              | Submit nova task (202 Accepted)           |
| GET    | `/api/v1/tasks`            | Lista tasks (limit, default 50)           |
| GET    | `/api/v1/tasks/:id`        | Task detail + telemetry                   |
| GET    | `/api/v1/tasks/:id/stream` | SSE stream da task                        |
| GET    | `/api/v1/sessions`         | Tasks ativas (running)                    |
| GET    | `/api/v1/work-items`       | Lista work items (with_tasks=1)           |
| GET    | `/api/v1/work-items/:id`   | Work item + child tasks                   |
| GET    | `/api/v1/logs`             | Telemetry entries (task_id, level, limit) |
| GET    | `/api/v1/metrics`          | Snapshot de metricas                      |
| GET    | `/api/v1/stats`            | Estatisticas detalhadas                   |
| GET    | `/api/v1/events`           | SSE global (Redis pub/sub)                |

### SSE Events

| Event              | Descricao                                        |
| ------------------ | ------------------------------------------------ |
| `session_start`    | Sessao iniciou                                   |
| `text_delta`       | Output de texto do modelo                        |
| `tool_use`         | Tool invocada (name, input)                      |
| `token_update`     | Consumo de tokens (used, budget, percent)        |
| `session_end`      | Completou (reason: completed/interrupted/failed) |
| `routing_decision` | Roteamento (complexity, mode, reason)            |
| `heartbeat`        | Sinal de liveness (NEW)                          |

### Data Models (key fields)

**work_items:** id, title, description, status, source, priority, dag, totalTokensUsed, totalCostUsd, tasksTotal, tasksCompleted, timestamps

**tasks:** id, workItemId, repo, branch, description, complexity, status, model, mode, tokensUsed, costUsd, durationMs, prUrl, prNumber, prStatus, attempt, maxAttempts, lastError, errorClass, validationResults, timestamps

**session_telemetry:** id, taskId, correlationId, eventType, data (jsonb), createdAt

**routing_history:** id, taskId, taskPattern, repo, complexity, model, success, tokensUsed, durationMs

**cost_snapshots:** id, periodType, periodStart, claudeTokens, alibabaTokens, totalTokens, estimatedSavingsUsd, firstPassSuccessRate

## 3. Design References

### Design Systems Base (awesome-design-md)

**Primarios:**

- **Linear** — Dark-mode-native, hierarquia por luminosidade, borders semi-transparentes, 4 niveis de texto por opacidade
- **Vercel** — Shadow-as-border, pipeline tricolor, metric cards com numero grande
- **VoltAgent** — Single accent color (emerald), agent flow diagrams, glow effect em elementos ativos

**Secundarios:**

- **Cursor** — AI Timeline vertical com cores semanticas por operacao (thinking, grep, read, edit)
- **Supabase** — Zero shadows dark mode, profundidade via border hierarchy
- **Resend** — Frost borders, code preview como conteudo principal

### Patterns para Roubar (por feature)

**Task List:**

- Linear: lista densa, uma linha por task, status dot colorido
- Graphite: inbox com at-a-glance status icons inline

**Real-time Logs:**

- Vercel: ANSI-colored log stream com auto-scroll e search
- Cursor: Timeline vertical com cores semanticas por tipo de operacao
- Railway: Logs inline no contexto da task (split pane)

**Pipeline Visualization:**

- GitHub Actions: DAG horizontal com status color por node
- Vercel: Pipeline tricolor com fases nomeadas

**Metrics:**

- Vercel: numero grande + label + sparkline trend
- Compact: "12.4K tokens" / "$0.08"

**Task Submission:**

- Linear: modal com campo de texto unico + Cmd+Enter

**Layout:**

- Sidebar colapsavel + main content
- Dark mode native (nao dark theme sobre light)
- Single accent color
- Border-based depth (sem shadows)
- 8px spacing grid
- Font: Inter ou Geist

## 4. Proposta de Simplificacao

### De 5 telas para 3 views

| View             | O que mostra                                             | Combina                      |
| ---------------- | -------------------------------------------------------- | ---------------------------- |
| **Tasks** (home) | Lista de todas as tasks + detail pane com logs real-time | Pipeline + Executions + Logs |
| **Metrics**      | KPIs + charts + cost tracking                            | Metrics atual (melhorado)    |
| **Submit**       | Modal/drawer para submeter nova task                     | Novo                         |

**DAG removido** — premature, 99% das tasks sao single-node. Reintroduzir quando pipeline mode estiver ativo.

### Fluxo Principal

```
[Submit modal] → Task criada → Aparece na lista → Click → Live logs no detail pane
```

O usuario deve conseguir: submeter, acompanhar, e ver resultado sem trocar de pagina.

# ECHO — Finalized Architecture (Pre-Code)

Status: Approved direction, incorporating Researcher/God Mode, tri-modal decision system, and locked MVP scope.

---

## 1. Design Principles (locked)

1. **One agent interface, three decision backends.** Rule-Based, Utility-Based, and LLM-Assisted must be interchangeable strategies behind the same `DecisionStrategy` contract — same inputs (`AgentContext`), same output (`ActionIntent`). This is what makes RQ5 (rule-based vs. LLM trade-offs) an actual experiment instead of an apples-to-oranges comparison.
2. **God Mode is an intervention layer, not a bypass.** It changes the *environment* (prices, taxes, resource availability, tech unlocks, information injections) — never an individual agent's internal state or decision directly. This preserves the "events shape environment, agents decide" rule from the original spec.
3. **Everything MVP-scoped is a real slice, not a stub dressed as a feature.** If it's out of scope, it's out — documented as future work, not half-built.

---

## 2. Domain Model

```mermaid
classDiagram
    class Agent {
        +UUID id
        +str name
        +int age
        +Personality personality
        +str occupation
        +float wealth
        +UUID location_id
        +UUID household_id
        +EmotionalState emotional_state
        +float social_status
    }
    class Personality {
        +float openness
        +float conscientiousness
        +float extraversion
        +float agreeableness
        +float neuroticism
    }
    class Need {
        +str type
        +float value
        +float decay_rate
    }
    class Goal {
        +UUID id
        +str description
        +int priority
        +str status
        +float progress
    }
    class Memory {
        +UUID id
        +int tick
        +str type
        +str content
        +float importance
        +str source
    }
    class Relationship {
        +UUID agent_a_id
        +UUID agent_b_id
        +str type
        +float strength
        +float trust
    }
    class ActionIntent {
        +str action_type
        +dict params
        +float confidence
        +str reasoning
        +str produced_by
    }
    class World {
        +City city
        +list~Neighborhood~ neighborhoods
        +list~Business~ businesses
        +Market market
    }
    class Intervention {
        +UUID id
        +str type
        +dict params
        +int start_tick
        +int duration
        +str applied_by
    }

    Agent "1" --> "many" Need
    Agent "1" --> "many" Goal
    Agent "1" --> "many" Memory
    Agent "1" --> "many" Relationship
    Agent "1" --> "1" Personality
    Agent --> ActionIntent : produces via DecisionStrategy
    Intervention --> World : mutates
    World --> Agent : perceived by
```

---

## 3. Database ER Diagram

```mermaid
erDiagram
    SIMULATIONS ||--o{ AGENTS : contains
    SIMULATIONS ||--o{ EVENTS : has
    SIMULATIONS ||--o{ INTERVENTIONS : has
    SIMULATIONS ||--o{ EXPERIMENT_RUNS : "is one run of"

    AGENTS ||--o{ AGENT_NEEDS : has
    AGENTS ||--o{ AGENT_GOALS : has
    AGENTS ||--o{ MEMORIES : has
    AGENTS ||--o{ ACTIONS_LOG : performs
    AGENTS ||--o{ RELATIONSHIPS : "agent_a"
    AGENTS ||--o{ RELATIONSHIPS : "agent_b"
    AGENTS ||--o{ LLM_DECISION_LOGS : "may generate"
    AGENTS }o--|| LOCATIONS : "resides at"
    AGENTS }o--|| HOUSEHOLDS : "belongs to"

    LOCATIONS ||--o{ BUSINESSES : hosts
    BUSINESSES ||--o{ JOBS : offers
    AGENTS }o--o| JOBS : holds

    ACTIONS_LOG }o--o{ TRANSACTIONS : "may produce"

    EXPERIMENTS ||--o{ EXPERIMENT_RUNS : defines

    SIMULATIONS {
        uuid id PK
        int seed
        json config
        string scenario_id
        string version
        timestamp created_at
        string status
    }
    AGENTS {
        uuid id PK
        uuid simulation_id FK
        string name
        int age
        json personality
        string occupation
        float wealth
        uuid location_id FK
        uuid household_id FK
        json emotional_state
        float social_status
    }
    AGENT_NEEDS {
        uuid agent_id FK
        string need_type
        float value
        int updated_tick
    }
    AGENT_GOALS {
        uuid id PK
        uuid agent_id FK
        string description
        int priority
        string status
        float progress
    }
    MEMORIES {
        uuid id PK
        uuid agent_id FK
        int tick
        string type
        string content
        float importance
        string source
        json metadata
    }
    RELATIONSHIPS {
        uuid id PK
        uuid agent_a_id FK
        uuid agent_b_id FK
        string type
        float strength
        float trust
        int updated_tick
    }
    ACTIONS_LOG {
        uuid id PK
        uuid agent_id FK
        int tick
        string action_type
        bool preconditions_met
        json effects
        float cost
        string produced_by
    }
    LLM_DECISION_LOGS {
        uuid id PK
        uuid agent_id FK
        int tick
        string model
        float temperature
        string prompt_version
        text raw_response
        json parsed_decision
        bool validation_passed
    }
    EVENTS {
        uuid id PK
        uuid simulation_id FK
        string type
        float magnitude
        int start_tick
        int duration
        json params
    }
    INTERVENTIONS {
        uuid id PK
        uuid simulation_id FK
        string type
        json params
        int start_tick
        int duration
        string applied_by
    }
    EXPERIMENTS {
        uuid id PK
        string hypothesis
        json control_config
        json treatment_config
        int num_runs
        json seeds
    }
    EXPERIMENT_RUNS {
        uuid id PK
        uuid experiment_id FK
        uuid simulation_id FK
        string group
        json results
    }
    LOCATIONS { uuid id PK  string name  string type  uuid neighborhood_id FK }
    HOUSEHOLDS { uuid id PK  uuid location_id FK }
    BUSINESSES { uuid id PK  uuid location_id FK  string name  float cash  json price_table }
    JOBS { uuid id PK  uuid business_id FK  uuid held_by FK  float wage  bool open }
    TRANSACTIONS { uuid id PK  int tick  uuid from_agent FK  uuid to_agent FK  float amount  string type }
```

**Note on Intervention vs. Events:** both mutate world state through the same `WorldMutation` mechanism. `EVENTS` are scenario-scripted (defined ahead of time, part of a scenario config); `INTERVENTIONS` are researcher-triggered at runtime via God Mode. Keeping them as separate tables (rather than collapsing into one) preserves a clean audit trail of "what was planned" vs. "what the researcher did live" — this matters for reproducibility reporting.

---

## 4. Module Dependency Diagram

```mermaid
flowchart TD
    subgraph API["apps/api"]
        ROUTES[api/ routes]
        CORE[core/ config, rng, logging]
        SCHEMAS[schemas/ Pydantic IO models]
    end

    subgraph SIM["simulation/"]
        ENGINE[SimulationEngine]
        CLOCK[Clock / Tick Loop]
        EVENTQ[EventQueue]
        GODMODE[InterventionController]
    end

    subgraph AGENTS["agents/"]
        AGENTMODEL[Agent model]
        DECISION[DecisionRouter]
        RULE[RuleBasedStrategy]
        UTILITY[UtilityStrategy]
        LLMSTRAT[LLMStrategy]
        ACTIONS[Action system]
    end

    subgraph MEMORY["memory/"]
        MEMSTORE[MemoryStore]
        RETRIEVAL[Relevance-scored retrieval]
    end

    subgraph SOCIETY["society/"]
        RELGRAPH[Relationship graph]
        NETX[NetworkX analysis]
    end

    subgraph ECONOMY["economy/"]
        MARKET[Market/pricing]
        JOBSYS[Jobs/wages]
        LEDGER[Transaction ledger]
    end

    subgraph ANALYTICS["analytics/"]
        METRICS[Metrics aggregation]
        EXPORT[CSV/JSON export]
    end

    subgraph EXPERIMENTS["experiments/"]
        RUNNER[Headless ExperimentRunner]
        COMPARE[Control vs Treatment stats]
    end

    subgraph MODELS["models/ (SQLAlchemy)"]
        DB[(PostgreSQL)]
    end

    ROUTES --> ENGINE
    ROUTES --> RUNNER
    ENGINE --> CLOCK
    ENGINE --> EVENTQ
    ENGINE --> GODMODE
    ENGINE --> AGENTMODEL
    AGENTMODEL --> DECISION
    DECISION --> RULE
    DECISION --> UTILITY
    DECISION --> LLMSTRAT
    RULE --> ACTIONS
    UTILITY --> ACTIONS
    LLMSTRAT --> ACTIONS
    LLMSTRAT --> SCHEMAS
    AGENTMODEL --> MEMSTORE
    DECISION --> RETRIEVAL
    ACTIONS --> RELGRAPH
    ACTIONS --> MARKET
    ACTIONS --> LEDGER
    RELGRAPH --> NETX
    ENGINE --> METRICS
    RUNNER --> ENGINE
    RUNNER --> COMPARE
    METRICS --> EXPORT
    ENGINE --> DB
    MEMSTORE --> DB
    RELGRAPH --> DB
    LEDGER --> DB
    METRICS --> DB

    classDef locked fill:#1a1a2e,stroke:#e94560,color:#fff
    class GODMODE,DECISION locked
```

Key dependency rule: **`agents/` never imports from `apps/api/routes`.** The simulation core must be runnable as a plain Python library from a script (needed for headless experiments running 10–30 sims without going through HTTP). FastAPI is a thin consumer of `simulation/`, not the other way around.

---

## 5. Simulation Tick Lifecycle

```mermaid
sequenceDiagram
    participant Clock
    participant GodMode as InterventionController
    participant World
    participant Agent
    participant Decision as DecisionRouter
    participant Actions as Action System
    participant Events as Domain Event Bus
    participant Persist as Persistence/Analytics

    Clock->>GodMode: check pending interventions(tick)
    GodMode->>World: apply active interventions/events
    World-->>World: update prices, resources, tech flags

    loop for each agent (seeded shuffle order)
        World->>Agent: perceive(world_state, local_context)
        Agent->>Agent: update needs (decay + perception effects)
        Agent->>Decision: request_action(AgentContext)
        Decision->>Decision: select strategy (rule/utility/llm per action-type config)
        Decision-->>Agent: ActionIntent
        Agent->>Actions: submit(ActionIntent)
        Actions->>Actions: validate preconditions
        alt valid
            Actions->>World: apply effects
            Actions->>Events: emit ActionExecuted
        else invalid
            Actions->>Events: emit ActionRejected
            Actions->>Decision: fallback to rule-based (if LLM/utility failed)
        end
    end

    Events->>Persist: batch write (actions, transactions, relationships, memories)
    Events->>Persist: publish tick-complete metrics
    Clock->>Clock: increment tick
```

Notes:
- Agent iteration order is **seeded-shuffled per tick**, not fixed, to avoid systematic first-mover advantage — but the shuffle itself is deterministic given the seed.
- Inter-agent effects (e.g., a transaction touching two agents) are queued during the agent loop and resolved in a single batch pass immediately after, to avoid order-dependent double effects.
- Persistence is async/batched, not per-action, to protect write throughput (Risk 5 from the original review).

---

## 6. Decision Pipeline (tri-modal, experimentally comparable)

```mermaid
flowchart LR
    CTX[AgentContext<br/>needs, goals, memory,<br/>perception, relationships]

    CTX --> ROUTER{DecisionRouter<br/>mode = config per<br/>simulation/experiment}

    ROUTER -->|mode: rule| RULE[RuleBasedStrategy<br/>deterministic if/else<br/>+ priority tables]
    ROUTER -->|mode: utility| UTIL[UtilityStrategy<br/>score candidate actions<br/>by weighted need/goal fit]
    ROUTER -->|mode: llm| LLM[LLMStrategy<br/>prompt built from CTX<br/>+ structured JSON output]

    RULE --> INTENT[ActionIntent]
    UTIL --> INTENT
    LLM --> VALIDATE{Pydantic<br/>validation}
    VALIDATE -->|pass| INTENT
    VALIDATE -->|fail, retry budget left| LLM
    VALIDATE -->|fail, no retries left| RULE

    INTENT --> LOG[DecisionLog<br/>records: mode used,<br/>inputs hash, output,<br/>timing, cost]
```

**Why this matters for the research questions:** because all three strategies consume the identical `AgentContext` and emit the identical `ActionIntent` schema, an experiment can run the *same scenario, same seed, same population* three times — once per mode — and the only variable is decision-making logic. That's what makes RQ5 a real controlled comparison instead of a vibes-based claim.

**Mode selection granularity:** configurable per action-type, not just globally. Simple actions (`move`, `eat`) can be forced to `rule` regardless of the simulation's default mode, so an "LLM-Assisted" experiment run doesn't burn API calls on trivial actions — it means "LLM available for ambiguous/high-stakes actions," matching Section 10/29 of your original spec (cost control).

---

## 7. God Mode / Researcher Intervention Layer (architecture only, no UI yet)

`InterventionController` sits between the API layer and `World`. It exposes a small, explicit set of intervention types — it does **not** allow arbitrary state writes:

- `PriceShock(target: str, multiplier: float, start_tick, duration)`
- `TaxPolicy(rate: float, applies_to: str, start_tick, duration)`
- `ResourceShortage(resource_type: str, availability_multiplier: float, start_tick, duration)`
- `TechnologyIntroduction(tech_id: str, effect_params: dict, start_tick)`
- `InformationInjection(content: str, credibility: float, seed_agents: list[UUID], start_tick)` *(stubbed interface only — real propagation is out of MVP scope, but the intervention type is reserved now so the schema doesn't need breaking changes later)*

Each intervention is logged to `INTERVENTIONS` with `applied_by` (researcher/system) for the audit trail. Interventions go through the **same `WorldMutation` application path** as scripted `EVENTS` — this is the guardrail that stops God Mode from becoming a backdoor that bypasses the "environment changes, agents decide" rule.

No UI, no auth model, no endpoint wiring yet — just the controller class, the intervention type registry, and the DB table. This is intentionally sequenced into Phase 8 (Events), not Phase 0.

---

## 8. Finalized MVP Scope

**In:**
100 agents · 1 city · 5 neighborhoods · needs · goals · short/long-term memory (no embeddings) · basic relationships · basic economy (jobs, wages, spending, simple pricing) · rule-based decisions fully working · utility-based decisions fully working · LLM-assisted decisions wired with real provider calls but limited to a small, configurable set of action types · God Mode backend (controller + intervention types + logging), no UI · one working headless experiment (**Memory Impact**, control = memory disabled vs treatment = memory enabled) · Postgres persistence · plain functional dashboard (status, start/pause/step, agent list, one agent profile view).

**Out (explicitly, documented as future work):**
pgvector/semantic memory · information propagation system · multi-city/migration · full experiment UI (headless/script-driven only) · God Mode UI · world map visualization · advanced network topology comparisons · notification/auth system beyond basic protection.

---

## 9. Phase 0 — Exact Implementation Plan

Phase 0 produces **structure and contracts, zero business logic**, so that every later phase has a stable interface to build against.

**Deliverables:**

1. **Monorepo scaffold** — `apps/api`, `apps/web`, `simulation/`, `docs/`, `scripts/`, `docker-compose.yml`, `.env.example`, `README.md` skeleton per the original repo structure.
2. **`docker-compose.yml`** — Postgres + Redis services, no app containers yet (run API/web locally against composed services during dev).
3. **`apps/api/app/core/`** — config loader (env-based), structured logging setup, and the **single seeded RNG provider** (`core/rng.py`) that every future random call in `simulation/` and `agents/` must go through. This is the reproducibility root — establishing it in Phase 0 means nothing downstream can quietly introduce an unseeded `random.random()`.
4. **`apps/api/app/schemas/`** — Pydantic contracts only, no implementations: `AgentContext`, `ActionIntent`, `DecisionStrategy` (protocol/ABC), `WorldMutation`, `Intervention` base + the five intervention types listed in Section 7. These are the interfaces every later phase implements against.
5. **`simulation/` package skeleton** — `SimulationEngine`, `Clock`, `EventQueue`, `InterventionController` as empty classes with method signatures and docstrings only (`start()`, `pause()`, `resume()`, `step()`, `stop()`, `reset()`) — no tick logic yet.
6. **Alembic setup** — initial migration containing only `simulations` and a placeholder `agents` table (enough to prove the DB pipeline works end-to-end), not the full ER diagram yet — that's Phase 1.
7. **`apps/web` skeleton** — Next.js app with route groups matching the nav, each route rendering a placeholder "Phase N" page. No data fetching yet.
8. **Test harness** — pytest configured, one smoke test that boots `SimulationEngine`, calls `reset()`/`step()` on the empty skeleton, and asserts it doesn't throw. This proves the CI/test pipeline works before there's anything real to test.
9. **`docs/architecture.md`** — this document, committed as the source of truth, versioned going forward.

**Explicitly not in Phase 0:** no agent logic, no decision strategies implemented, no DB writes beyond the placeholder migration, no frontend data, no LLM provider calls.

**Definition of done for Phase 0:** `docker-compose up` brings up Postgres/Redis, `alembic upgrade head` runs cleanly, the smoke test passes, and `apps/web` renders its placeholder nav locally. Nothing simulates anything yet — that's Phase 2+.

---

## 10. Remaining Architectural Risks (3–4 month solo/small-team timeline)

1. **LLM strategy becomes a time sink disproportionate to its grading weight.** Wiring a real provider, validation, retries, and fallback for even a limited action set is a multi-day task on its own. Mitigate by scoping LLM-assisted mode to 2–3 action types max for MVP (e.g., `quit_job`, `major_relationship_decision`) — enough to make the tri-modal comparison real without it swallowing the schedule.
2. **Utility-Based mode needs tuning time you may not budget for.** Rule-based is easy to get "working," LLM-based is impressive but bounded in scope; Utility-based is the one that silently needs the most iteration to produce sensible behavior (weight tuning against sanity scenarios). Don't leave it as an afterthought between the other two — schedule explicit tuning time in Phase 4.
3. **God Mode's five intervention types risk becoming five mini-features instead of one mechanism.** Keep them thin wrappers over one `WorldMutation` applier; if any single intervention type needs bespoke logic beyond "adjust a world parameter over a tick range," that's a sign it's scope creep for MVP.
4. **Three-way experiment comparison multiplies your run count.** Memory Impact experiment × 3 decision modes × N seeds for statistical validity could mean 60–90 simulation runs before you have anything to report. Decide early how many seeds is "enough to be honest but affordable" (5–10 is defensible for a final-year project if you say so explicitly in methodology, rather than promising 30 and running out of time).
5. **Solo/small-team context switching cost.** This architecture spans backend simulation, DB design, LLM integration, and frontend — each a real skill area. The phase-gate approval process you already required (Section 40 of your original spec) is the right mitigation; resist the urge to parallelize phases to "save time," since that's exactly where architectural drift and rework creep in.
6. **Examiner-facing risk, not technical:** if the LLM-assisted mode is scoped very small (item 1 above), be ready to explain *why* in your defense — frame it as a deliberate cost-control and reproducibility decision (which it genuinely is), not a shortcut. This is a stronger academic position than an over-scoped LLM layer that's flaky under examination.

---

**Next step (on your approval):** scaffold Phase 0 exactly as specified in Section 9 — structure, contracts, empty classes, one smoke test. No simulation logic.

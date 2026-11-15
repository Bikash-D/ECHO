# ECHO — Emergent Collective Human Organization

**A Multi-Agent Simulation Framework for Modeling Emergent Social Behavior in Autonomous AI Societies**

Final-year project. Status: **Phase 0 complete** (architecture + scaffolding, no simulation logic yet).

## Project overview

ECHO simulates a virtual society of autonomous agents with individual
personality, needs, goals, memory, and relationships, running on
discrete time-step "ticks." The system lets a researcher configure a
population, run simulations, inject controlled environmental
interventions, and observe how individual agent decisions aggregate
into emergent collective behavior — without hardcoding the collective
outcomes themselves.

Full architectural rationale, diagrams, and the finalized data/module
design live in [`docs/architecture.md`](docs/architecture.md).

## Problem statement & research objectives

See `docs/architecture.md` Sections 1–2 for the core concept and
primary/secondary research questions (RQ1–RQ5). In short: how do
autonomous agents with memory, goals, personality, and social
relationships produce emergent collective behavior, and how do
different decision-making architectures (rule-based, utility-based,
LLM-assisted) compare in producing it?

## Architecture

See `docs/architecture.md` for the full picture: domain model, ER
diagram, module dependency graph, tick lifecycle, and the tri-modal
decision pipeline. Summary of the stack:

- **Backend:** Python, FastAPI, Pydantic, SQLAlchemy, Alembic
- **Database:** PostgreSQL
- **Cache/queue:** Redis
- **Simulation:** Python, NetworkX, NumPy/Pandas
- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **AI:** provider-agnostic LLM interface (no single vendor hardcoded)

## Repository structure

```
echo/
├── apps/
│   ├── web/          # Next.js dashboard
│   └── api/           # FastAPI app + simulation core
│       ├── app/
│       │   ├── api/            # HTTP routes (thin layer)
│       │   ├── core/           # config, logging, seeded RNG
│       │   ├── models/         # SQLAlchemy ORM models
│       │   ├── schemas/        # Pydantic contracts (Agent/Action/Decision/etc.)
│       │   ├── simulation/     # SimulationEngine, Clock, EventQueue, InterventionController
│       │   ├── agents/         # (Phase 3+)
│       │   ├── memory/         # (Phase 5+)
│       │   ├── economy/        # (Phase 7+)
│       │   ├── society/        # (Phase 6+)
│       │   ├── analytics/      # (Phase 10+)
│       │   └── experiments/    # (Phase 12+)
│       ├── alembic/            # DB migrations
│       └── tests/
├── simulation/        # scenario configs, seeds, experiment definitions (data, not code)
├── docs/               # architecture.md, and future research/methodology/api docs
├── scripts/
├── docker-compose.yml  # Postgres + Redis
└── .env.example
```

## Installation & running locally (Phase 0 state)

### Prerequisites
- Python 3.12+
- Node.js 18+
- Docker & Docker Compose (for Postgres/Redis) — *or* locally installed Postgres 16 / Redis 7

### 1. Infrastructure

```bash
docker compose up -d
```

This starts Postgres (`localhost:5432`, db/user/pass = `echo`/`echo`/`echo`) and Redis (`localhost:6379`).

### 2. Backend API

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../../.env.example .env   # adjust if needed
alembic upgrade head
uvicorn app.main:app --reload
```

Visit `http://localhost:8000/api/health` — should return simulation profile and population size.

### 3. Frontend

```bash
cd apps/web
npm install
npm run dev
```

Visit `http://localhost:3000`.

### 4. Tests

```bash
cd apps/api
source .venv/bin/activate
python -m pytest -v
```

## Running simulations / experiments

Not yet available — the simulation engine has no tick logic until
Phase 2+. This section will be filled in as those phases land.

## Database

Schema and migrations managed via Alembic (`apps/api/alembic/`). See
`docs/architecture.md` Section 3 for the full target ER diagram — only
`simulations` and a placeholder `agents` table exist as of Phase 0.

## API

Not yet meaningfully populated beyond `/api/health`. Full API docs
will be added to `docs/api.md` as routes are implemented.

## Research methodology

See `docs/architecture.md` Sections 8–10 (MVP scope, Phase 0 plan,
architectural risks) for how this project is sequenced to support
real experimental comparisons rather than scripted demo outcomes.

## Limitations (current, Phase 0)

- No simulation logic exists yet — this phase is structure and
  contracts only, by design.
- LLM-assisted decision mode has no provider wiring yet (Phase 9).
- Frontend has no data fetching yet — placeholder pages only.

## Future work

Full roadmap in `docs/architecture.md` Section 9 (development
strategy) — semantic/vector memory, information propagation,
multi-city/migration, and the full experiment/God-Mode UI are
explicitly deferred past MVP.

# AutoAssess UI-DSS — Partner Integration Tutorial

Welcome! This tutorial gets you from "fresh clone" to "building on the stack" during the integration week.

AutoAssess UI-DSS (User Interface & Decision Support System) lets inspectors **plan** autonomous inspection missions of confined marine spaces (ballast water tanks, cargo holds), and **review** the results — 3D maps, structural elements, thickness (UT/NDT) measurements, drone images, defects — all stored in **Cognite Data Fusion (CDF)**.

The repo has two halves that meet in CDF:

| Half | Where | What it's for |
|---|---|---|
| **Web viewer** | repo root (`src/`) | React + Three.js app hosted in Cognite Fusion ("Flows app"). Plan missions, view 3D results, reports. |
| **Ground-station SDK + CLI** | [`sdk/`](../../sdk) | Python package `uidss` with the `dss` CLI. Download plans to the robot, upload mission artifacts back. |

## Chapters

| # | Chapter | Who | Time |
|---|---|---|---|
| 1 | [Architecture & mission lifecycle](01-architecture.md) | Everyone | 15 min |
| 2 | [The CDF data model](02-data-model.md) | Everyone | 20 min |
| 3 | [Setup & credentials](03-setup-credentials.md) | Everyone | 20 min |
| 4 | [Track A — Ground station: `dss` CLI & Python SDK](04-ground-station-sdk.md) | Robot / ground-station partners | 1–2 h |
| 5 | [Track B — Web viewer: run it & add a feature](05-web-viewer.md) | Front-end / UX partners | 2 h |
| 6 | [Track C — Analysis on CDF data](06-analysis-on-cdf-data.md) | Perception / ML / analysis partners | 1–2 h |
| 7 | [End-to-end exercise](07-end-to-end-exercise.md) | Everyone (in mixed teams) | 1–2 h |
| 8 | [Gotchas, etiquette & FAQ](08-gotchas-and-faq.md) | Everyone — **read before day 1** | 10 min |

### Suggested paths

- **Robot / ground-station team:** 1 → 2 → 3 → 4 → 7 → 8
- **Web / UX team:** 1 → 2 → 3 → 5 → 7 → 8
- **Perception / analysis team:** 1 → 2 → 3 → 4 (skim) → 6 → 7 → 8

## Prerequisites checklist

Install before arriving:

- [ ] **Git** and access to `github.com/cognitedata/autoassess-ui-dss`
- [ ] **Python 3.12** and [**uv**](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- [ ] [**just**](https://github.com/casey/just) (optional, task runner for the SDK — `brew install just`)
- [ ] **Node.js 20+** and npm (web track only)
- [ ] A modern browser with WebGL2 (Chrome/Edge recommended)

You'll receive from the AutoAssess team:

- [ ] **CDF client credentials** (client ID + secret) for the shared project `autoassess-dev` on cluster `westeurope-1`
- [ ] **Fusion user login** for the `cog-autoassess` organization (to open the web app)
- [ ] Your **partner prefix** (e.g. `ntnu`, `eth`) — use it when naming vessels/areas you create (see [chapter 8](08-gotchas-and-faq.md#shared-project-etiquette))

## Other docs in the repo

- [`README.md`](../../README.md) — quick start
- [`PRD.md`](../../PRD.md) — product requirements, full data model rationale, roadmap
- [`AGENTS.md`](../../AGENTS.md) / [`sdk/AGENTS.md`](../../sdk/AGENTS.md) — coding standards for each half
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — checks to run before opening a PR

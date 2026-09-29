# AutoAssess UI-DSS

UI-DSS (User Interface and Decision Support System) is the human-facing web application through
which inspectors plan inspection campaigns, and review and act on the results of autonomous UAS
drone inspections of confined marine spaces — primarily ballast water tanks and cargo holds. It's
a [Cognite Flows](https://docs.cognite.com/cdf/flows/) app backed by Cognite Data Fusion (CDF) for
data storage and modeling.

See [`PRD.md`](PRD.md) for the full product requirements, data model, and viewer architecture.

## Prerequisites

- Node.js 20+ and npm
- Access to the private `@cognite` npm registry (already configured via `.npmrc`)

## Quick start

```bash
npm install
npm run dev
```

The app runs against the Flows/Fusion host, which handles CDF authentication — no local `.env` is
needed just to run the UI. A `.env` (see `.env.example`) is only required for the one-off data
tooling scripts under `scripts/` (see [Scripts](#scripts) below).

## Project structure

- `src/features/` — one folder per domain feature (`vessels`, `areas`, `viewer`, `reports`,
  `recommendations`), each following the ViewModel pattern described in [`AGENTS.md`](AGENTS.md):
  a `use<Name>ViewModel` hook holds logic, view components only render, and `*Service.ts` files
  wrap CDF access behind an interface.
- `src/shared/cdf/dataModel.ts` — the **authoritative** CDF data model (spaces, containers, views)
  for this whole repo. It's mirrored by `sdk/src/uidss/cdf/data_model.py`; see the note at the top
  of that file before changing either.
- `src/__mocks__/` — shared mock-data factories reused across tests.
- `sdk/` — a separate Python project (the `dss` ground-station CLI/SDK). See
  [`sdk/README.md`](sdk/README.md) and [`sdk/AGENTS.md`](sdk/AGENTS.md); it has its own toolchain
  and conventions, independent of the rest of this file.

## Related repositories

- **`autoassess_bridge` ROS node** — the robot-side interface (plans out over ROS topics, mission
  uploads and findings back to CDF). Lives on the
  [`gbplanner_ros-autoassess` branch of omkarsawant99/gbplanner_ros](https://github.com/omkarsawant99/gbplanner_ros/tree/gbplanner_ros-autoassess).
  The full interface list of the stack is in
  [docs/tutorial/09-d62-data-in-the-ui.md](docs/tutorial/09-d62-data-in-the-ui.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm start` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc`) and build for production |
| `npm run preview` | Preview a production build locally |
| `npm test` | Run the test suite once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:ui` | Run tests with the Vitest UI |
| `npm run lint` / `npm run lint:fix` | Lint (and autofix) with ESLint |
| `npm run deploy` / `npm run deploy-preview` | Deploy via `@cognite/cli` (interactive) |
| `npm run setup-dm` | One-off: apply the CDF data model from `src/shared/cdf/dataModel.ts` |
| `npm run upload-3d` | One-off: upload 3D assets to CDF |
| `npm run generate-correspondences-pcd` / `generate-trajectory-pcd` | One-off: generate PCD test fixtures |

The `setup-dm` and `upload-3d` scripts read CDF credentials from `.env` — copy `.env.example` to
`.env` and fill in your values first.

## Testing

Tests use [Vitest](https://vitest.dev/) and live next to the code they test as `*.test.ts(x)`
files (no separate `__tests__` tree). See [`AGENTS.md`](AGENTS.md) for the test-first workflow and
minimum coverage expectations by file type.

## Architecture & data model

Full details live in [`PRD.md`](PRD.md):

- **§6 Data Model** — how CDF spaces/containers/views map to the app's domain entities.
- **§7 3D Viewer Architecture** — the custom Three.js rendering pipeline in `src/features/viewer/`
  (layers, workers, caching) and why it replaced `@cognite/reveal`.
- **§8 Tech Stack** — the full dependency list and rationale.

Coding conventions (dependency injection, interface-based services, the ViewModel pattern,
TypeScript rules, test structure) are in [`AGENTS.md`](AGENTS.md) (symlinked as `CLAUDE.md`).

## Deployment

`npm run deploy` / `npm run deploy-preview` use `@cognite/cli` to deploy the app under the Flows
`appsApi` infra described in `app.json` (target org/project/cluster) and `manifest.json` (network
permissions / CSP).

## Ground station SDK

The `dss` CLI for downloading inspection plans and uploading mission artifacts (PLY/PCD maps,
NDT measurements, drone images) lives in [`sdk/`](sdk/README.md) — a separate Python package with
its own `uv`-based toolchain. See `sdk/README.md` for installation and usage, and `sdk/AGENTS.md`
for its conventions.

## Related docs

| Doc | Contents |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) / `CLAUDE.md` | Coding standards for this (TS/React) half of the repo |
| [`PRD.md`](PRD.md) | Product requirements, data model, viewer architecture |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute: workflow, checks, sync obligations |
| [`sdk/README.md`](sdk/README.md) | Ground station CLI installation and usage |
| [`sdk/AGENTS.md`](sdk/AGENTS.md) | Coding standards for the Python half of the repo |

## History

The app was migrated from the legacy "Dune" Fusion hosting model to Flows, and the Python ground
station SDK (`sdk/`) was later consolidated into this repo from a separate repository. Both
migrations are complete — see `git log` for details if you're curious, but nothing here is
currently mid-migration.

# Contributing

## Repo structure

This repo has two halves, each with its own conventions doc:

- **Root** — the TS/React/Vite Flows app. Conventions: [`AGENTS.md`](AGENTS.md) (symlinked as
  `CLAUDE.md`).
- **`sdk/`** — a separate Python project (the `dss` ground-station CLI/SDK) with its own `uv`
  toolchain. Conventions: [`sdk/AGENTS.md`](sdk/AGENTS.md) (symlinked as `sdk/CLAUDE.md`) —
  read that instead of the root `AGENTS.md` when working under `sdk/`; it supersedes the root
  doc for files in that directory.

Read the relevant `AGENTS.md` before making changes — this file only summarizes the workflow
around it, it doesn't restate the standards themselves.

## Test-first workflow

Write tests before implementation for all non-trivial behavior changes:

1. Integration tests (user-visible behavior) first, then unit tests, then the implementation.
2. Every new service, ViewModel hook, utility, or component needs a co-located `*.test.ts(x)`
   (root) or `tests/unit/test_<name>.py` (`sdk/`) in the same changeset.
3. For bug fixes, add a failing regression test first.

See the minimum-coverage-by-file-type table in `AGENTS.md` (root) or the testing philosophy
section in `sdk/AGENTS.md` for specifics.

## Before opening a PR

**There is no CI in this repo yet** — these local checks are currently the only gate before
review, so run them before pushing:

- Root: `npm run lint` and `npm test`
- `sdk/`: `just check` and `just test` (or `just test-all` if you touched anything that needs
  integration coverage)

## Keeping the CDF data model in sync

`src/shared/cdf/dataModel.ts` (root) is the authoritative CDF data model. If you change a space,
container, or view — or bump a view version — you must mirror that change in
`sdk/src/uidss/cdf/data_model.py` in the same PR. There's no automated check for this, so it's
easy to miss; both files carry a comment pointing at this obligation, but it's ultimately a manual
step. See `sdk/AGENTS.md` for the exact rule.

## Agent skills

`.claude/skills/` and `.agents/skills/` contain vendored Cognite Flows certification skills
(code quality, security, performance, test coverage, design review, etc.) used by AI coding
agents working in this repo. They're reference material for agents, not something you need to run
manually, but worth knowing about if an agent's behavior in this repo seems oddly specific.

# email-replu

Inbox-zero reply plugin for Claude Code (working name — ships as **ask-marcel v2**): triages the Outlook inbox, researches each email that needs an answer, drafts threaded replies in the user's voice, and grows an OKF-native knowledge base. Read-mostly by design — the only Microsoft writes are unsent drafts, always through the `ask-marcel-office` CLI (v2).

The full design lives in [SPEC.md](SPEC.md) (22 recorded decisions, build plan in §16). All code follows the [atelier standard](.agents/skills/atelier/SKILL.md) — strict TDD, Clean Architecture, `Result<T, E>` at IO boundaries, gates enforced by hooks.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (`curl -fsSL https://bun.sh/install | bash`)
- Optional for the pre-commit secret scan: `brew install gitleaks` (the hook degrades gracefully without it)

## Setup

```bash
bun install
git config core.hooksPath .githooks   # eight-gate pre-commit + Conventional Commits validator
```

## Scripts

| Command | What it does |
|---|---|
| `bun test` | Run the test suite (coverage always on, per `bunfig.toml`) |
| `bun run lint` | Fast lint, zero warnings tolerated |
| `bun run lint:strict` | Full type-aware lint (what the pre-commit gate runs) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run coverage` | Per-tier coverage gate: 100% domain & use-cases, 80% infra/composition/presenter |
| `bun run mutate` | Stryker mutation testing on domain + use-cases (break < 90%) |
| `bun run mutate:changed` / `mutate:staged` | Mutation on changed / staged files only |
| `bun run start` | Run `src/main.ts` (placeholder entry) |

## CLI entries

| Command | What it does |
|---|---|
| `bun scripts/doctor.ts [--json]` | Setup report: tool versions (bun/qmd/ask-marcel-office), M365 auth probe, KB/profile presence — with a fix per failing check. Exit 0 with a report; exit 1 only on crash. |
| `bun scripts/kb-init.ts [--json]` | Create the OKF knowledge-base skeleton under `data/kb/` (idempotent — an existing KB is never touched). |

`LOG_LEVEL` (default `info`; the CLI entries quiet it to `error` unless explicitly set) controls the Winston logger.

## Layout

```
src/
├── domain/        # pure logic: email-state machine, branded RunId, Result — 100% coverage, mutation-gated
├── use-cases/     # primary ports (advance-email-state, …) + ports/ (Logger, StateStore) — 100% coverage
├── infra/         # adapters (Winston logger, Bun.spawn command runner, Bun.file probe/writer) — each with a test seam
├── presenter/     # output envelopes for skills & hooks (doctor report text/JSON)
├── composition/   # config (LOG_LEVEL) + build-deps wiring per entry point
└── test-helpers/  # hand-written fakes (logger, state store) — no mocking library, ever
scripts/           # gate scripts + thin CLI entries (console allowed here only): doctor.ts, kb-init.ts
.githooks/         # pre-commit (8 gates) + commit-msg (Conventional Commits)
.agents/skills/    # the atelier standard this repo is built under
data/              # runtime KB / profile / scratch — gitignored, never leaves the machine
```

## CLI entries (continued)

`bun scripts/kb-seed.ts [--json]` — seed person/org pages from the Microsoft directory (manager, direct reports, top colleagues); never overwrites; capped (config); every page logged in `data/kb/log.md`.

## Using as a plugin (v0.1 dev mode)

Load the repo directly: `claude --plugin-dir ~/Documents/email-replu`, then invoke the `setup` skill ("set up the plugin"). Run from the repo root — `data/` (KB, profile, scratch) resolves relative to the working directory in v0.1.

## Status

M0 + M1 complete — doctor, OKF kb-init, qmd collection, directory seeding, and the `setup` skill all run for real. Next on the SPEC §16 ladder: M2 (inbox scan + triage + Gate 1).

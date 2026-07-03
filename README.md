# email-replu

Inbox-zero reply plugin for Claude Code (working name — ships as **ask-marcel v2**): triages the Outlook inbox, researches each email that needs an answer, drafts threaded replies in the user's voice, and grows an OKF-native knowledge base. Read-mostly by design — the only Microsoft writes are unsent drafts, always through the `ask-marcel` CLI.

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
| `bun run start` | Run `src/main.ts` (composition wiring lands at M1) |

## Layout

```
src/
├── domain/        # pure logic: email-state machine, branded RunId, Result — 100% coverage, mutation-gated
├── use-cases/     # primary ports (advance-email-state, …) + ports/ (Logger, StateStore) — 100% coverage
├── infra/         # adapters (Winston logger; ask-marcel CLI runner from M1) — each with a test seam
├── presenter/     # output envelopes for skills & hooks (from M2)
├── composition/   # wiring per entry point (from M1)
└── test-helpers/  # hand-written fakes (logger, state store) — no mocking library, ever
scripts/           # gate scripts + thin CLI entries (console allowed here only)
.githooks/         # pre-commit (8 gates) + commit-msg (Conventional Commits)
.agents/skills/    # the atelier standard this repo is built under
data/              # runtime KB / profile / scratch — gitignored, never leaves the machine
```

## Status

M0 (scaffold + walking skeleton) complete — the SPEC §16 ladder continues with M1 (doctor + setup skill).

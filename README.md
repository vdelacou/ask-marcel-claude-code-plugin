# email-replu

Inbox-zero reply plugin for Claude Code (working name — ships as **ask-marcel v2**): triages the Outlook inbox, researches each email that needs an answer, drafts threaded replies in the user's voice, and grows an OKF-native knowledge base. Read-mostly by design — the only Microsoft writes are unsent drafts. All Microsoft 365 access goes through the imported `ask-marcel-office-cli` **library** (the `Office` port), never the CLI binary and never a raw Graph client (SPEC §15.1, R1-R4); `qmd` and `bun` remain the only spawned tools.

The full design lives in [SPEC.md](SPEC.md) (23 recorded decisions, build plan in §16). All code follows the [atelier standard](.agents/skills/atelier/SKILL.md) — strict TDD, Clean Architecture, `Result<T, E>` at IO boundaries, gates enforced by hooks.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (`curl -fsSL https://bun.sh/install | bash`)
- Optional for the pre-commit secret scan: `brew install gitleaks` (the hook degrades gracefully without it)

## Setup

```bash
bun install
git config core.hooksPath .githooks   # nine-gate pre-commit + Conventional Commits validator
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
| `bun scripts/doctor.ts [--json]` | Setup report: bun & qmd versions, a live Microsoft 365 auth probe (a `get-current-user` through the library), the qmd `replu-kb` collection, and KB/profile presence — with a fix per failing check. Exit 0 with a report; exit 1 only on crash. |
| `bun scripts/kb-init.ts [--json]` | Create the OKF knowledge-base skeleton under `data/kb/` (idempotent — an existing KB is never touched). |

`LOG_LEVEL` (default `info`; the CLI entries quiet it to `error` unless explicitly set) controls the Winston logger.

## Layout

```
src/
├── domain/        # pure logic: email-state machine, branded RunId, Result — 100% coverage, mutation-gated
├── use-cases/     # primary ports (advance-email-state, …) + ports/ (Logger, StateStore) — 100% coverage
├── infra/         # adapters (Winston logger, Office library adapter, Bun.spawn qmd/bun runner, Bun.file probe/writer/binary-writer) — each with a test seam
├── presenter/     # output envelopes for skills & hooks (doctor report text/JSON)
├── composition/   # config (LOG_LEVEL) + build-deps wiring per entry point
└── test-helpers/  # hand-written fakes (logger, state store) — no mocking library, ever
scripts/           # gate scripts + thin CLI entries (console allowed here only): doctor, login, kb-init/seed, inbox-scan, voice-extract, read-mail, fetch-email-bundle, read-doc, search-exec, kb-queue, draft-apply, write-kb-page, kb-lint, kb-index-gen, state
.githooks/         # pre-commit (9 gates, incl. the R4 library-only fence) + commit-msg (Conventional Commits)
.agents/skills/    # the atelier standard this repo is built under
data/              # runtime KB / profile / scratch — gitignored, never leaves the machine
```

## CLI entries (continued)

`bun scripts/kb-seed.ts [--json]` — seed person/org pages from the Microsoft directory (manager, direct reports, top colleagues); never overwrites; capped (config); every page logged in `data/kb/log.md`.

`bun scripts/inbox-scan.ts [--scope unread|all] [--cap N] [--json]` — Phase 1 of inbox-zero: list the inbox, apply rule-based drops (no-reply senders, calendar responses, `data/profile/blocked-senders.txt`), mint a run under `data/scratch/<run-id>/` and initialize its state machine.

`bun scripts/state.ts <runId> show | advance <emailId> <toState>` — inspect or advance a run's per-email state machine; illegal transitions are refused with a typed error.

`bun scripts/voice-extract.ts [--keep N] [--json]` — build the voice corpus: the last N substantive messages the user wrote (from:me, all folders), quoted chains and signatures stripped, bucketed.

`bun scripts/fetch-email-bundle.ts --run-id <id> --email-id <id> --conversation-id <id> [--json]` — Phase 3 (§7): assemble one email's research bundle (whole thread as markdown, every attachment, resolved SharePoint docs) under `data/scratch/<run>/<email>/bundle/`.

`bun scripts/read-doc.ts --run-id <id> --email-id <id> --name <name> --drive-id <id> --item-id <id> [--json]` — read one drive item as markdown (pulling any embedded images alongside it via `extract-drive-item-images`), falling back to rendering its PDF pages when the conversion is scrambled (§7).

`bun scripts/search-exec.ts --query "<q>" [--backends kb,mail,sharepoint] [--json]` — one search round (§6): fan out across the requested backends in parallel, print one merged, deduped, source-tagged hit list.

`bun scripts/kb-queue.ts append --run-id <id> --candidate '<json>' | drain --run-id <id> [--json]` — queue research facts/jargon per run (§8), drained in one batch to kb-curator at wrap-up.

`bun scripts/draft-apply.ts --run-id <id> --email-id <id> --conversation-id <id> --reply-to <messageId> --subject "<s>" --body-file <path> [--json]` — Phase 4 (§2): create or update the UNSENT reply draft for a `user_approved` email (the code approval gate), then advance to `draft_created`. Never sends.

`bun scripts/read-mail.ts --message-id <id>` (prints one message as markdown) or `--conversation-id <id> [--top N] [--json]` (lists a thread) — the R4-compliant read path used by triage-scout.

`bun scripts/write-kb-page.ts --page-file <path> [--json]` — kb-curator's write mechanic (§8): land one vetted OKF page, creating it or merging under a dated `## Update`, and append the log line.

`bun scripts/kb-lint.ts [--json]` — kb-gardener Phase 1: report OKF-conformance issues (missing frontmatter/fields, duplicate slugs) across `data/kb/`.

`bun scripts/kb-index-gen.ts [--json]` — kb-gardener Phase 1: regenerate every folder's `index.md` from its concept pages (derived data).

`bun scripts/login.ts` — authenticate to Microsoft 365 via the library's browser sign-in (cached → refresh → Playwright). One-time prerequisite: `bunx playwright install`.

## Using as a plugin

The entry scripts resolve their own location via `${CLAUDE_PLUGIN_ROOT}`, so **the plugin runs from any working directory**. `data/` (KB, profile, scratch) lives in the folder you launch Claude Code from, not the plugin cache; set `ASK_MARCEL_HOME=/path` to pin it to a fixed location instead.

**Dev mode (recommended while iterating)** loads the repo in place, from anywhere:

```bash
alias replu='claude --plugin-dir ~/Documents/email-replu'
replu   # from any folder, then: "set up the plugin"
```

**Install it (persistent)** via a local marketplace:

```
/plugin marketplace add ~/Documents/email-replu
/plugin install email-replu@email-replu
```

A `SessionStart` hook runs `bun install --production` on first use so the cached copy has the Office library. Your `data/` is unaffected by plugin updates because it lives in your launch folder, not the ephemeral install cache; set `ASK_MARCEL_HOME` if you launch from varying folders and want `data/` pinned to one fixed path.

## Status

M0-M7 functionally complete, plus the full library-only migration (decision 19, R1-R4 enforced). Triage (scan + triage-scout + Gate 1), the M5 research pipeline (`fetch-email-bundle` with attachments + SharePoint, `read-doc` with embedded-image extraction plus PDF fallback, the search module over kb/mail/sharepoint, the KB queue, the `email-researcher` agent), the M6 drafting loop (`draft-apply`'s code approval gate, `write-kb-page`, the `kb-curator` agent, and the `inbox-zero` skill's full Phase 0-5 orchestration), and the M7 gardener (`kb-lint`, `kb-index-gen`, the `kb-gardener` skill, pre-research mode, scheduling) are all built and green. The read-only pipeline (auth, scan, bundle, search) is live-verified against a real inbox. The Office library is sourced from npm (`ask-marcel-office-cli@^2.0.0`), and the plugin runs from any folder via `--plugin-dir` or a local-marketplace `/plugin install`.

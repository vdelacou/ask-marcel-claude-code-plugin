# ask-marcel — dev guide

Inbox-zero reply plugin for Claude Code. The full design is [SPEC.md](SPEC.md) (23 decisions,
build plan §16, all M0-M7 landed); the engineering contract is the atelier standard at
[.agents/skills/atelier/SKILL.md](.agents/skills/atelier/SKILL.md) — consult it BEFORE writing
or modifying any code here.

## Commands

- `bun install` once per clone; `git config core.hooksPath .githooks` (9-gate pre-commit).
- The four-check loop before every commit: `bun test` + `bun run lint` + `bun run typecheck` +
  `bun run coverage`. Mutation: `bun run mutate:staged` (the pre-commit gate runs it; ≥90% on
  staged domain/use-case files).
- New file under src/infra|composition|presenter? Regenerate the coverage preload in the same
  commit: `bun run scripts/regenerate-coverage-preload.ts`.

## Binding rules (short form — the details live in SPEC §15)

- No `class` / `function` declarations / `interface` / `console` outside `scripts/`+`src/main.ts`.
- `Result<T, E>` at every IO boundary; `try/catch` only in `src/infra/**`, entries, and
  pure-domain native fallbacks. Hand-written fakes only; `mock` from bun:test is banned.
- **R1-R4 (SPEC §15.1)**: Microsoft 365 is reached ONLY through the `Office` port over the
  imported `ask-marcel-office-cli` library. Never spawn an `ask-marcel-office` binary, never
  touch the raw Graph client, imports fenced to `src/composition/**` + `src/infra/office.ts`,
  skills/agents call `bun scripts/*.ts`. eslint + `scripts/check-r4-fence.sh` enforce this.
- Tests are confirmation-gated (atelier rules 11/24): propose failing tests before writing them;
  never weaken or delete silently. No commit/push without the user's explicit go (rule 25).
- **Privacy**: no real person/company identifiers in files, fixtures, or commit history — use
  fictional domains (internal-corp.com, maison-lumiere.com). History was purged once
  (2026-07-11); never reintroduce.

## Plans & context recovery (how work is tracked here)

Every non-trivial task gets a written plan with a **definition of done per item**, kept in a
file — not only in the conversation — so a lost session resumes at the same point with the
same information:

- Live task board: the newest `.claude/AUDIT-*.md` (item → DoD → status `open|fixed|verified`).
- Session journal: [.claude/LESSONS.md](.claude/LESSONS.md) (append-only `[mistake]/[decision]/[gotcha]`;
  check it at session start, propose candidates at session end).
- Update the board line the moment an item lands; a re-audit pass flips `fixed → verified`.

## Layout in one glance

`src/domain` (pure logic, 100% cov + mutation-gated) · `src/use-cases` (+`ports/`, 100%) ·
`src/infra` (adapters with test seams, 80%) · `src/presenter` · `src/composition`
(config + build-deps wiring) · `scripts/` (thin CLI entries — stdout IS the interface) ·
`skills/` + `agents/` + `hooks/` (the plugin surface) · `data/` (runtime KB/profile/scratch/
reports/state — gitignored, never leaves the machine).

Run `bun scripts/doctor.ts --json` as the setup smoke test. `data/` resolves from the working
directory (`ASK_MARCEL_HOME` overrides): scripts `process.chdir` there first.

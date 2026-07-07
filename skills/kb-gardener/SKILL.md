---
name: kb-gardener
description: Keep the local OKF knowledge base healthy - lint it for conformance, regenerate the folder indexes, and propose a curation plan (merge duplicates, split oversized pages, rewrite stale summaries). Runs weekly on a schedule and on demand. Use when the user says "garden the KB", "clean up the knowledge base", "lint the KB", "regenerate the KB indexes", "tidy my knowledge base", or "run the gardener". Read-mostly: the only writes are regenerated index files and, after your approval, kb-curator edits.
---

# KB gardener

Two phases: Phase 1 is deterministic and safe to auto-apply; Phase 2 is a plan you approve before anything changes. All KB writes go through scripts / kb-curator - never hand-edit `data/kb/**`. Any working directory is fine - the scripts run via `${CLAUDE_PLUGIN_ROOT}` and pin `data/` to the plugin home.

## Phase 1 - lint + reindex (deterministic, auto-apply)

1. **Lint.** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/kb-lint.ts" --json`. Parse the issues (missing frontmatter, missing required fields, duplicate slugs). Report them grouped by kind. Read-only - linting never edits.

2. **Regenerate indexes.** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/kb-index-gen.ts" --json`. This rewrites every folder's `index.md` from its concept pages (derived data). Report how many were regenerated.

## Phase 2 - curation plan (LLM, plan-then-apply)

3. **Draft a plan** from the lint issues plus a read of the KB structure: merge duplicate-slug pages into one, split an oversized page into a new category, move a mis-filed page, rewrite a stale or empty summary. Write it as a short plan (one line per action, each with its rationale).

4. **Gate the plan.**
   - **Interactive:** show the plan; AskUserQuestion per action (apply / skip / edit). Execute each approved action through a `kb-curator` agent (so the log, lint, and index stay consistent) - never by editing `data/kb/**` directly.
   - **Unattended (scheduled):** auto-apply only the reversible subset (index regeneration, frontmatter fixes); buffer every merge/split/move for a human and report them - never destructive without a human.

5. **Reindex.** One `qmd update && qmd embed` for the whole run so search reflects the changes.

## Hard rules

- Phase 1 is safe to auto-apply; Phase 2 destructive actions (merge, split, delete, move) require the user's approval interactively, or are buffered when unattended - never silently.
- All KB writes go through `bun "${CLAUDE_PLUGIN_ROOT}/scripts/*.ts"` or a kb-curator agent; never hand-edit `data/kb/**`, so create-vs-merge, logging, and lint stay consistent.
- Regenerated indexes are derived data - never hand-curate a folder `index.md`.
- Report every issue found, every index regenerated, and every action applied or buffered - no silent changes.

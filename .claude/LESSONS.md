# Lessons | Memory Across Sessions

Append-only journal of `[mistake]` / `[decision]` / `[gotcha]` entries — see `.agents/skills/atelier/references/lessons.md` for the format. Never edit or delete past entries; supersede with a new `[decision]`.

## [mistake] 2026-07-04 | git add -A swept a cache file into a commit

The M0 scaffold commit included .eslintcache because staging used `git add -A`. It took a follow-up chore commit to untrack it and extend .gitignore. Stage explicit paths for every commit; `-A` is only acceptable when the tree is provably clean of generated files.

## [decision] 2026-07-04 | plan commit splits at proposal time

TDD slices with golden-pinned tests routinely exceed the 300-line commit gate (doctor: 352, kb-seed: ~500 as one unit). Because mutate:staged requires staged domain/use-case files to carry their killing tests in the same commit, splits must follow behavior seams (tool checks vs file checks, domain builders vs use-case), not file types. Decide the split when proposing the tests, not when staging.

## [gotcha] 2026-07-04 | Stryker incremental cache lies across test-only changes

With testRunner "command" (bun test), Stryker's incremental file does not register test changes, so a strengthened suite reported the identical 79.87% score byte-for-byte. Delete reports/stryker-incremental.json before trusting any score after editing tests.

## [gotcha] 2026-07-04 | sonarjs super-linear-regex distrusts quantified classes

The rule flagged /[^a-z0-9]+/ and its bounded {1,64} variant alike, while the semver {1,4} passed. The reliable idiom is single-character classes plus split/filter/join, which also subsumes edge trimming. Applies to any slug or token normalization.

## [gotcha] 2026-07-04 | bun toEqual ignores undefined array holes

`expect([seed, undefined]).toEqual([seed])` passes in bun:test, so a mutant that removes a `.filter(isDefined)` step survives toEqual-only assertions. Pin list sizes with toHaveLength wherever a filter is load-bearing.

## [decision] 2026-07-04 | cli binary renamed to ask-marcel-office at v2

ask-marcel-office-cli v2.0.0 renamed the binary from `ask-marcel` to `ask-marcel-office` (same command surface; create-reply-draft still pending). The doctor gates on ask-marcel-office >= 2.0.0; every invocation, fixture, and doc was swept on 2026-07-04. The old name may disappear from PATH at any time.

## [decision] 2026-07-04 | standing consent for strengthening-only test edits

Per-edit rule-24 asks made mutation-hardening loops cost a round-trip each; Vincent granted session-scoped standing consent for STRENGTHENING-ONLY test edits (adding fixtures/assertions inside approved scenarios), reported after the fact. Weakening or new scenarios still require explicit asks. Propose this mode early whenever a hardening loop starts.

## [mistake] 2026-07-04 | pipeline tails masked gate exit codes

`bun run mutate | grep score && echo OK` reports grep's exit, not the gate's - a failing mutation run read as green twice in one session. Read a gate's verdict from its own exit code (run it as the last pipeline-free command) or from the persisted report, never from a filter's exit.

## [gotcha] 2026-07-04 | coercion fixtures kill guard-function mutants

Type-guard halves like `typeof v === 'string' && v in TABLE` produce survivors because ordinary fixtures fail both halves together. Exploit JS coercion to split them: `['done'] in TABLE` is true (array coerces to 'done'), so a `{m1: ['done']}` fixture distinguishes the typeof check from the key check.

## [decision] 2026-07-04 | v0.1 entries resolve data/ from the working directory

doctor.ts, kb-init.ts, and kb-seed.ts all address data/kb and data/profile relative to CWD, so v0.1 must run from the repo root (documented in README and the setup skill). Before shipping as an installed plugin, thread a base directory through config into the composition root instead of hardcoding relative paths.

## [gotcha] 2026-07-05 | mutate:staged runs minutes on multi-file commits

The pre-commit mutation gate mutates every staged domain/use-case file. A 3-file / 335-mutant commit took 2m42s; a 2-minute command timeout killed `git commit` mid-gate (exit 143) while the gate was passing (0 survived), so nothing landed and the files stayed staged. Budget a long timeout (>= 600000 ms) for any commit touching more than one src/ file, and read the verdict from the hook's own exit code, not the wrapper's.

## [decision] 2026-07-05 | fetch-email-bundle split by metadata-vs-rendering seam

The use-case plus its mutation-complete tests came to 377 lines, over the 300-line commit gate, and email-thread.ts is classicist-tested only through the use-case (no dedicated test), so it cannot land in its own commit. Split the feature by behaviour seam, not file type: B1 = thread-membership metadata manifest (list-conversation-messages -> chronological manifest), B2 = per-message markdown rendering (convert-mail-to-markdown -> path + status). The coming attachments and SharePoint slices of fetch-email-bundle will exceed 300 the same way — pre-plan their seams when proposing the tests.

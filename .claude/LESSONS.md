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

## [gotcha] 2026-07-05 | empty conversion output renders as status 'failed'

`asString('')` returns undefined (it treats '' as absent), so `extractMarkdown` on a convert-mail-to-markdown / read-mail-attachment response whose `text` is `''` returns an err, and the bundle marks that message body or attachment `status: 'failed'` with no file written. Real behaviour, not a bug — an empty render is treated as no content. When a test needs a 'converted' outcome, feed non-empty markdown; empty-string fixtures surface as 'failed' (cost 3 test failures to spot).

## [decision] 2026-07-05 | M365 access is library-only — never the CLI binary, never raw Graph

Per user directive, the plugin reaches Microsoft 365 ONLY through the imported `ask-marcel-office-cli` library. HARD RULES (SPEC §15.1, decision 19): (R1) never spawn the `ask-marcel-office` binary — not code, scripts, skills, or login; `CommandRunner` is for `qmd`/`bun` only. (R2) never call the raw `buildDeps().graph`; all Graph access is `commands[name].execute(graph, params)` (the registry has no `send`, so it is the safe surface). (R3) import `ask-marcel-office-cli` only in `src/composition/**` + `src/infra/office.ts`; login via `buildDeps().makeLoginAuth()`. (R4) skills call `bun scripts/*.ts`, never bash the binary. Lint enforcement activates once the migration drops the last spawn; draft-approval moves from the Bash `draft-gate` hook to the code state-machine gate. The binary may be uninstalled.

## [decision] 2026-07-06 | the library migration is an envelope-drop, and the domain is untouched

`commands[name].execute(graph, params)` returns the command's DATA object directly (`Result<data, GraphError>`) — no `{ok,data}` envelope, no exit code. So migrating a use-case off `CommandRunner` deletes the whole envelope layer: drop `parseEnvelope`, drop the `exitCode !== 0` check, and pass `run.value` straight to the existing domain extractor. The domain extractors (extractThreadMessages, extractMarkdown, extractAttachments, ...) already took the unwrapped `data`, so NONE of them changed — only use-case plumbing did. The Office adapter is pattern 2b (two-constructor): `createOfficeFromRegistry(registry, graph)` for tests, `createOffice()` = real `commands` + `buildDeps({}).graph`. Params are raw strings keyed by the command's canonical `key` (verify keys via `commands[name].meta.options`), and `execute` validates them internally. `get-mail-attachment`/`download-drive-item-as-pdf` return `{base64}` — decode with `Uint8Array.fromBase64` (native in Bun; throws on malformed) and write via a separate `BinaryWriter` port.

## [gotcha] 2026-07-06 | a mechanical migration removes killer tests along with dead branches

Dropping the envelope layer deletes the `exitCode`/`invalid-json` mutants AND the failure-mode tests that killed them, which un-masks pre-existing logger-call and error-shape survivors (they were always uncovered, just outnumbered). A migrated use-case that was >=90% before can fall to ~86%. Recover cheaply: assert `logger.calls` on the happy path (kills the `logger.info('event', {})` mutants) and re-add the param assertions the old CLI-string tests carried (e.g. `list-relevant-people {top:'15'}`) that the command-name-only fake dropped. Budget this hardening into every migration slice.

## [gotcha] 2026-07-06 | Set-based heuristics are mutation-hostile; prefer few predicates

`assessMarkdownQuality` with `DELIMITERS = new Set([...13 chars])` scored 67% — each Set member is a StringLiteral mutant needing its own load-bearing fixture, most unkillable for a ratio metric. Rewriting to a single `char > ' '` predicate (keeps every printable/any-script char, drops space + C0 controls) plus two named ratio thresholds cut the surface to ~15 mutants and hit 92%. When a domain heuristic needs a character class, reach for a range comparison before a literal Set; pin thresholds with exact-boundary fixtures (23 vs 24 chars, one-replacement-in-a-long-doc).

## [gotcha] 2026-07-06 | git checkout to revert a probe also reverts uncommitted real edits

To undo a temporary R4-fence probe line appended to `agents/triage-scout.md`, `git checkout agents/triage-scout.md` reverted the WHOLE file to HEAD - silently discarding the legitimate uncommitted R4 migration edits in the same file. On a tracked file with unstaged real work, never `git checkout <file>` to undo a probe: append then remove the exact probe lines (or write to a scratch file, or stage the real work first). `checkout`/`restore` on a dirty tracked file is a blast radius, not a surgical undo.

## [decision] 2026-07-06 | R4 fence is a grep gate, not eslint (eslint cannot lint .md)

R1 (no binary spawn) and R3 (library import boundary) are eslint rules on `src/**`, but R4 (skills/agents call `bun scripts/*.ts`, never the binary) lives in `.md`/prose that eslint does not see. Enforce it with `scripts/check-r4-fence.sh` - a `grep -rnE 'ask-marcel-office (login|logout|update|[a-z][a-z]*-[a-z-]+)'` over skills/ agents/ scripts/ - wired as pre-commit gate 3. The verb pattern is deliberate: it matches binary invocations but NOT the `-cli` library name (a `-` follows `office`, not a space) nor prose like "never a raw ask-marcel-office command" (`command` has no hyphen). Login went through `makeLoginAuth().getAccessToken()` (the cached->refresh->browser flow; `login` is neither exported nor in the `commands` registry), wrapped as a testable `runLoginWith(makeAuth)` in office.ts.

## [gotcha] 2026-07-06 | an infra smoke test that hits real data/ breaks the Stryker sandbox

`bun test` was green (232) but `stryker run` died with "There were failed tests in the initial test run." Cause: the FileLister production-wiring smoke listed `data/kb/**/*.md`, but Stryker copies the tree into `.stryker-tmp/` WITHOUT the gitignored `data/`, so the glob returned empty and the assertion failed only under mutation. Point production-wiring smokes at files that exist in every environment (the source tree - `src/infra/*.ts`), never at gitignored runtime dirs. A green `bun test` does not prove a green mutation run when a test touches the real filesystem.

## [gotcha] 2026-07-06 | sonarjs no-alphabetical-sort fires on string-field sorts, not date-field sorts

`.sort()` with no comparator, and `.sort((a,b)=>Number(a.title>b.title)-...)` on a `title`, both trip `sonarjs/no-alphabetical-sort` (strict lint) demanding `String.localeCompare` - but the identical code-point comparator on `receivedDateTime` (email-thread) passes, because the rule exempts date-ish fields. Resolution: for GITIGNORED generated data (KB indexes), localeCompare is fine and correct (no committed artifact, so host-locale order causes no cross-host diff); for committed/chronological data keep the code-point compare on a date field. Match the field to the rule, do not fight it.

## [decision] 2026-07-06 | verify tool output shapes against the real tool before building a parser

The search module parses three backends: qmd `search --json` (a BARE JSON array `[{docid,file,title,snippet,context}]`, not an envelope — use the new `parseJson`, not `parseEnvelope`), `search-mail-messages` (`{value:[message]}`), and `microsoft-search-query` (nested `{value:[{hitsContainers:[{hits:[{hitId,summary,resource}]}]}]}`). All three were confirmed by running `qmd search ... --json` live and reading `commands[name].meta.responseShape` BEFORE writing extractors — no guessed interfaces. qmd is a non-M365 tool, so it stays on `CommandRunner` (R1 permits qmd/bun); mail + sharepoint ride the Office port. search-round fans the backends out with `Promise.all`, each resilient (a failure records a `{backend,message}` and contributes no hits).

## [gotcha] 2026-07-11 | mutate:changed is blind to untracked files

mutate-changed.sh builds its file list from `git diff` against BASE/HEAD plus the index — a brand-NEW untracked source file appears in none of those, so seven freshly created domain/use-case files silently skipped mutation while the run reported green (91.25%). When a slice adds new files, run stryker on them explicitly (`bunx stryker run --mutate "src/domain/new-file.ts,..."`) or stage them first so `--cached` sees them; never read an aggregate score as coverage of files the differ never listed.

## [gotcha] 2026-07-11 | filter-repo rewrites refs but not sibling worktrees' files

`git filter-repo --replace-text` rewrote all 100 commits and updated every branch ref, including one checked out in a live sibling worktree — but that worktree's on-disk FILES and index kept the old content, leaving it dirty against its own rewritten HEAD and still holding the purged string. After any history rewrite, `git -C <worktree> restore --source=HEAD --staged --worktree <files>` the affected paths (its plain `checkout --` restores from the stale index, not HEAD). Also: filter-repo removes `origin` by design — re-add it before the force-push, and take a `git bundle create ... --all` backup first.

## [gotcha] 2026-07-11 | renderer string mutants die by golden toBe, not toContain probes

A markdown renderer probed with nine `toContain` assertions scored 65% — every unprobed template literal was a surviving StringLiteral mutant. Replacing the probes with ONE golden full-output `toBe` (exact joined-lines string) killed the whole cluster at once (65% -> 95%), and a `split('\n')` `toHaveLength` pin on the minimal-input render kills the empty-section ArrayDeclaration mutants the golden's featured path misses. For any domain function whose output IS a document, write the golden first; probes are for behavior, not for surfaces.

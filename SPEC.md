# email-replu — Inbox-Zero Reply Plugin (SPEC v0.1 — for review)

A Claude Code **plugin** (skills alone can't ship hooks/agents — see §12) that triages the Outlook inbox, researches each email that needs an answer, drafts threaded replies in the user's voice, and grows a fresh **OKF-native knowledge base**. Read-mostly by design: the only writes to M365 are unsent drafts.

Builds on proven assets from `~/Documents/CODE/ask-marcel/ask-marcel-plugin` (ported, not shared): `create-reply-draft.ts` (Graph `createReplyAll`), `draft-preflight.ts`, `extract-own-body.ts`, kb-curator/doc-reader agent contracts, hook patterns. External deps: `ask-marcel` CLI (M365), `qmd` (local search), `bun` (runtime).

**Design principles**
1. Deterministic where possible: every mechanical step is a Bun/TypeScript script with JSON in/out, runnable standalone, covered by `bun test`. LLM only where judgment is required.
2. Flow is *enforced*, not suggested: a per-run state machine gates every transition; a PreToolUse hook physically blocks draft creation without recorded user approval.
3. Sub-agents never talk to the user (platform constraint). All interactive gates run in the main thread: **parallel research, serial dialogs**.
4. Voice profile lives **outside** the KB (`data/profile/`), never indexed, never gardened.
5. KB capture is **queued per email** and drained in one batch — same guarantee as "capture after every read", ~5× fewer lint/embed cycles.
6. **Always-loaded context**: `data/profile/user.md` + `data/kb/jargon/abbreviations.md` are injected at session start (SessionStart hook) and re-verified as step 1 of every skill — nothing starts before they are read.
7. **Contradiction gate**: new information that contradicts the KB or `user.md` is never written silently — the main thread asks the user for the truth via AskUserQuestion; unattended runs buffer contradictions to a reconcile queue drained at the next interactive session.
8. **Language**: KB and profile are written in the user's primary language (auto-detected from sent mail during voice-profile build, stored in `about-me.md`); email drafts follow thread/recipient language per voice rules.

---

## 1. Folder layout

```
email-replu/
├── .claude-plugin/plugin.json        # manifest — name: "ask-marcel" (v2 — collision note §14)
├── CLAUDE.md                         # dev guide (how to test, conventions)
├── SPEC.md                           # this file
├── skills/
│   ├── setup/SKILL.md                # doctor + guided installs + KB init + profile
│   ├── inbox-zero/SKILL.md           # the main orchestrator (phases 1–5)
│   ├── voice-profile/SKILL.md        # build/refresh writing profile
│   └── kb-gardener/SKILL.md          # recurring KB cleaning/curation
├── agents/
│   ├── triage-scout.md               # per-email needs-reply verdict (haiku)
│   ├── email-researcher.md           # per-email deep read + search + 3 strategies
│   ├── doc-reader.md                 # one document → digest (haiku, escalate model)
│   └── kb-curator.md                 # one OKF page write + log + lint
├── hooks/
│   ├── hooks.json
│   ├── session-context.ts            # SessionStart: inject user.md + jargon into context
│   ├── preflight-tools.ts            # PreToolUse Bash: block if CLIs missing → setup
│   ├── draft-gate.ts                 # PreToolUse Bash: block draft cmds w/o approval state
│   └── kb-postwrite.ts               # PostToolUse Edit|Write on data/kb: lint that file
├── src/                              # ONE Bun package — atelier Clean Architecture (§15)
│   ├── domain/                       # state-machine transitions, confidence rubric, OKF page model, triage
│   │                                 #   rules, queue/jargon logic; branded types at trust boundaries
│   │                                 #   (SharePointUrl, ScratchPath, KbSlug, EmailAddress…)
│   ├── use-cases/                    # scan-inbox, fetch-email-bundle, read-doc, search-round, apply-draft,
│   │                                 #   drain-kb-queue, lint-kb, gen-kb-index, extract-voice, run-doctor
│   │                                 #   + ports/ (CliRunner, GraphFetch, FileStore, Clock, Logger…)
│   ├── infra/                        # adapters: ask-marcel CLI runner, qmd runner, Bun.file store, clock
│   │                                 #   — each with a test seam (§15); NO Graph client (decision 19)
│   ├── presenter/                    # JSON/text envelopes the skills and hooks consume
│   ├── composition/                  # wiring per entry point; config.ts (caps, batches, thresholds)
│   └── test-helpers/                 # hand-written fakes for secondary ports
├── scripts/                          # THIN CLI entries only (console sanctioned here — their output IS the
│                                     #   interface): doctor.ts, inbox-scan.ts, fetch-email-bundle.ts,
│                                     #   read-doc.ts, search-exec.ts, state.ts, draft-apply.ts, kb-queue.ts,
│                                     #   kb-lint.ts, kb-index-gen.ts, draft-preflight.ts, voice-extract.ts
├── references/
│   ├── search-module.md              # the search contract (§6)
│   ├── read-email.md                 # full-thread reading recipe (§7)
│   ├── read-document.md              # md→images→pdf decision rule (§7)
│   ├── okf-kb.md                     # page schema per type (§8)
│   ├── people-orgs.md                # person/org/team modeling + dedup rules (§8b)
│   └── drafting.md                   # bucket voice, 3-strategy rule, preflight
├── data/                             # runtime, gitignored
│   ├── kb/                           # ★ NEW OKF bundle (fresh — no migration)
│   │   ├── index.md                  # root index, frontmatter: okf_version: "0.1"
│   │   ├── log.md                    # OKF reserved: date-grouped, newest first
│   │   ├── people/index.md …         # + orgs/ projects/ topics/ decisions/ meetings/ jargon/
│   ├── profile/                      # voice-profile.md, about-me.md, user.md, signature.* — NOT KB
│   ├── scratch/<run-id>/             # bundles, packages, state.json (7-day retention)
│   ├── reports/                      # one markdown per run — permanent ops history (drift stats, tuning)
│   └── state/                        # inbox delta watermark, gardener last-run
└── tests/                            # bun test + fixtures/ (recorded CLI JSON envelopes)
```

---

## 2. The main flow (`inbox-zero` skill)

### Phase 0 — Setup gate (delegates to `setup` skill if anything missing)
`bun scripts/doctor.ts --json` checks, in order:
1. **bun** present (bootstrap chicken-and-egg: SKILL.md instructs the checks in prose if bun itself is missing) → guided install: `curl -fsSL https://bun.sh/install | bash` + append PATH export to `~/.zshrc`, verify with `bun --version`.
2. **qmd** present (≥2.5) → `bun install -g @tobilu/qmd`, then model warm-up note (~700 MB GGUF on first embed).
3. **ask-marcel-office** present (≥2.0.0 — the binary was renamed from `ask-marcel` at v2; `create-reply-draft` still pending, target next release) → `npm i -g ask-marcel-office-cli` / `ask-marcel-office update`.
4. **M365 auth** → probe with a cheap GET; only on failure propose `ask-marcel login`.
5. **KB initialized** → if `data/kb/` missing: create tree + root `index.md` (okf_version) + `log.md` + per-folder `index.md`; `qmd collection add data/kb --name replu-kb`; `qmd context add 'qmd://replu-kb' "…"`; `qmd update && qmd embed`.
6. **Voice profile exists** in `data/profile/` → if not, run `voice-profile` skill (§9).
7. **KB seeding** (first run only): create person pages for the manager, direct reports, and top colleagues (`list-relevant-people`), plus organization pages derived from their email domains (Graph enrichment: title, manager links). ~20–40 small pages, `source: seed`; one `qmd update && qmd embed` at the end.
8. **Scheduling** (optional, proposed at setup): register the weekly `kb-gardener` task, and the weekday **pre-research** run (time chosen by the user, e.g. 06:30) — both via Claude Code scheduled tasks.
Every fix is proposed via AskUserQuestion before running; doctor re-runs at the end (idempotent).

### Phase 1 — Scan (code)
`bun scripts/inbox-scan.ts --scope <all|unread|since-watermark> --cap 25 --json` (caps/batches live in `src/composition/config.ts`: v0.1 defaults 25/4/2, raised to 50/8/4 once the flow is proven)
- `ask-marcel list-mail-folder-messages --mail-folder-id inbox` (+ `--filter isRead eq false` when scoped), `$select` minimal fields.
- Rule-based drops **in code** (no LLM, no agents wasted): no-reply/notification senders, calendar responses, bulk headers, sender-domain blocklist file. Dropped items are still listed in the report ("skipped by rule X") — no silent gaps.
- Output `candidates.json`; `state.ts init` creates the run's state machine.

### Phase 2 — Triage fan-out (parallel sub-agents)
One **triage-scout** per candidate (model: haiku; batches of 4 in v0.1, config-raised later):
- Reads the conversation (`convert-mail-to-markdown` on the last N messages of the thread).
- KB context via **`qmd search` only** (BM25, no LLM rerank — parallel agents must not thrash the local reranker): sender, org, project names.
- Returns strict JSON: `{id, conversationId, from, subject, needs_reply, urgency: high|med|low, reason, kb_refs[]}`.
- Main thread merges → triage table. `state: scanned → triaged`.

### Gate 1 — User selection (main thread)
- Full table in chat: sender / subject / urgency / *why it needs an answer*.
- AskUserQuestion is capped at 4 options × 4 questions per call → multiSelect batches ("uncheck = skip"), 16 emails per call; preceded by a shortcut question ("draft all / let me deselect").
- `state: triaged → approved | skipped` per email.

### Phase 3 — Research fan-out (parallel sub-agents, batches of 2 in v0.1, config-raised later)
One **email-researcher** per approved email. Inside the agent:
1. `fetch-email-bundle.ts` (deterministic, §7): full thread markdown + **every** attachment across **all** thread messages (incl. inline images) + resolved SharePoint links → `scratch/<run>/<emailId>/bundle/`.
2. Read each document per the read-document rule (§7); docs >5k tokens go through doc-reader digests… *(researcher reads directly — sub-agents can't spawn sub-agents; the bundle keeps token cost per-email-isolated)*.
3. Formulate **the questions that must be answered** to reply correctly.
4. Run the **search module** (§6) per question — backends kb + mail + sharepoint in parallel, confidence-scored, ≤5 rounds.
5. Append KB candidate facts to `kb-queue.ts` (queued — NOT written).
6. Return a **package** (JSON to scratch): context summary, thread timeline, the questions + answers found (with confidence + citations), open gaps, **3 genuinely different reply strategies** (e.g. commit / clarify / redirect — each with one-line rationale + skeleton), proposed recipients (reply vs reply-all deltas).
- `state: approved → researched`.

### Phase 4 — Interactive loop (main thread, serial, per email)
1. Present the package: full context, what was found, what's missing — **including flagged contradictions and new jargon**.
2. **Contradiction gate**: for each contradiction the researcher flagged (email/doc fact vs KB or user.md), AskUserQuestion with both versions → the confirmed truth is written to the KB immediately (kb-curator, logged with rationale); the loser is corrected, never left ambiguous.
3. **AskUserQuestion**: "anything to add, or do you already have an answer in mind?" (options: proceed / add context via Other / I'll dictate the answer).
4. **AskUserQuestion**: the 3 strategies (+ Other).
5. Draft in main thread — voice-profile bucket voice (§9), signature, language choice per recipient/thread.
6. `draft-preflight.ts` must exit 0 (rewrite loop until clean).
7. Show draft → **AskUserQuestion**: approve / request changes. On approve: `state → user_approved`.
8. `draft-apply.ts`: search Drafts for an existing draft on this `conversationId` (`list-mail-folder-messages --id drafts --filter`) → **`ask-marcel update-mail-draft`**; else **`ask-marcel create-reply-draft`** (new CLI command, Graph `createReplyAll` under the hood — threaded, quoted history, inherited recipients) then update body/subject. All through the CLI — the plugin holds no Graph client and no token (decision 19). Never sends. `state → draft_created`.
9. Drain this email's KB queue: batches to **kb-curator** (§8). `state → kb_captured → done`.

### Phase 5 — Wrap-up (code + report; run-level gates)
- **Jargon drain**: every abbreviation/codename encountered this run (flagged by any agent, queued via `kb-queue.ts --kind jargon`) is proposed to the user in one batch → accepted entries land in `kb/jargon/abbreviations.md` with expansion + one-line meaning.
- **user.md curation pass**: add what this session taught about the user, improve wording, remove stale entries (§9); the diff summary appears in the report.
- One `qmd update && qmd embed` for the whole run (not per write).
- Report table: drafted / updated / skipped(by user / by rule) / blocked(+why); draft edit/reject rate (voice-drift indicator, §9). Coverage block — any source that errored is named. Saved to `data/reports/<run-id>.md` (permanent — the drift alert and triage-rule tuning read this history).
- Advance inbox watermark; scratch retention sweep (7 days).

### Unattended pre-research mode (`inbox-zero --pre-research`, in v0.1)

Runs Phases 0–3 headless on a schedule (e.g. weekday mornings before work) so the interactive session starts with everything already researched:
- **Gate 1 is deferred**: every triage-positive email is researched *speculatively* (the price of overnight prep — research for emails you later deselect is discarded; the `--cap` bounds the cost).
- **Contradictions buffer** to the reconcile queue (no user available); **jargon candidates queue**; `user.md` is never modified unattended.
- **Drafting is physically impossible overnight**: `user_approved` state cannot exist in an unattended run, so the `draft-gate` hook denies every draft command by construction.
- The next interactive `inbox-zero` detects the pre-researched run and **resumes the same run-id**: drains the reconcile queue first, shows the triage table at Gate 1 (deselect discards that email's package), then goes straight into Phase 4 dialogs — the slow work is already done.

### State machine (enforced by `state.ts`, every step script refuses illegal transitions)
```
per email:
  scanned → triaged → (approved | skipped)
  approved → researched → context_confirmed        # contradictions resolved + user additions
          → strategy_chosen → drafted → preflight_ok
          → user_approved → draft_created → kb_captured → done
per run:
  init → context_loaded → …emails… → jargon_drained → user_md_reviewed → reindexed → wrapped
```
`context_loaded` requires user.md + jargon read (design principle 6); `wrapped` is unreachable while any email queue is non-empty. Resume-safe: re-running `inbox-zero` picks up mid-run state instead of restarting. Pre-research runs carry `mode: pre-research` and may not advance any email past `researched`; the interactive resume lifts that restriction.

---

## 3. Hooks (flow enforcement — the backstop; the state machine is the primary gate)

| Hook | Event / matcher | Behavior |
|---|---|---|
| `session-context.ts` | SessionStart | Prints `data/profile/user.md` + `data/kb/jargon/abbreviations.md` → injected into context automatically, every session. Makes "always read first" physical, not conventional. |
| `draft-gate.ts` | PreToolUse, Bash matching `draft-apply.ts\|create-reply-draft\|create-mail-draft\|update-mail-draft` | **Deny** unless `state.json` shows `user_approved` for the referenced email. Makes "no draft without approval" physical — and since ALL writes go through the CLI (decision 19), matching CLI commands covers every path. |
| `preflight-tools.ts` | PreToolUse, Bash | If `ask-marcel`/`qmd`/`bun` missing → deny with "run setup" message. |
| `kb-postwrite.ts` | PostToolUse, Edit\|Write under `data/kb/` | Lint **that file** (OKF conformance); reindex is deferred to Phase 5 / gardener (cheap, no embed storm). |

---

## 4. Agents (contracts)

| Agent | Model | Input | Output (strict) |
|---|---|---|---|
| `triage-scout` | haiku | email id + thread tail + qmd hints | verdict JSON (see Phase 2) |
| `email-researcher` | inherit (sonnet+) | email id, bundle path, voice-agnostic | package JSON (see Phase 3) incl. `contradictions[] {claim, kb_version, source_version, evidence}` and `jargon_candidates[] {term, guessed_meaning, context}` |
| `doc-reader` | haiku (parent may escalate) | one local file path + task line | ≤300-word digest, citations by page |
| `kb-curator` | haiku | vetted draft: `{folder, slug, type, title, description, resource, tags, content, citations[], rationale}` | `wrote/merged/collision/skipped` + log line appended + per-file lint pass |

Constraints stated in each agent file: no user interaction, no web, return raw data (final text = return value), never send mail.

---

## 5. Why plugin (not bare skills) — decision record

Hooks (§3), bundled agents (§4), `${CLAUDE_PLUGIN_ROOT}`-anchored scripts, and a marketplace-installable unit only exist at plugin level. Skills remain the orchestration surface; the plugin is the container. MCP server not needed — the `ask-marcel` CLI already provides tools with a read-mostly guarantee (prior art: Ask-Marcel-MCP solved auth via MCP; CLI approach superseded it).

---

## 6. Search module (reusable — used by triage light-mode, researcher full-mode, and `research`-style questions)

**Contract** (`references/search-module.md` + `scripts/search-exec.ts`):
- **Input**: one question, backends ⊆ {kb, mail, sharepoint}, mode light|full.
- **Round r ≤ 5**:
  1. LLM writes *context keywords* for the question (round 1) or *revised keywords* (round >1, informed by the logged keywords+results of rounds 1..r−1).
  2. `search-exec.ts` fans out **in parallel** and returns ONE merged, deduped, source-tagged list:
     - kb: `qmd search` (BM25 first — it IS BM25); escalate to `qmd query` with structured `intent:/lex:/vec:/hyde:` doc only in full-mode round ≥2, never in parallel-agent context.
     - mail: `ask-marcel search-mail-messages` (KQL ladder: specific → OR-broadened).
     - sharepoint/drive: `ask-marcel microsoft-search-query` (+ `search-onedrive-files` when drive-scoped).
  3. LLM picks candidates → reads them (`qmd get` / `convert-mail-to-markdown` / `download-drive-item-as-markdown`).
  4. **Confidence 0–100** rubric: facet coverage of the question, source authority, recency, corroboration (2 independent sources), contradiction penalty.
  5. ≥70 → synthesize. 40–69 → read more candidates from the same list, rescore. <40 or nothing relevant → revise keywords, next round.
- **Output**: comprehensive answer, per-claim citations (path/webUrl), final confidence, explicit gaps. Every round's keywords+results logged to scratch (auditable, testable).
- **Hard rules**: never answer from snippets alone; log what was dropped/capped.

---

## 7. Read email / read document (deterministic recipes)

**Read email** (`fetch-email-bundle.ts` + `references/read-email.md`):
1. `list-conversation-messages` → full thread, `convert-mail-to-markdown` each.
2. For **every message in the thread** (not just the last): `list-mail-attachments` → `read-mail-attachment` (auto-routes by real content type) → markdown into bundle; inline image attachments (`isInline`) extracted too.
3. `extract-sharepoint-links-in-mail` per message → resolve → `download-drive-item-as-markdown` (+ `extract-drive-item-images`).
4. Bundle manifest lists every artifact + conversion status (no silent failures).

**Read document** (`read-doc.ts` + `references/read-document.md`):
1. Convert to markdown. 2. Extract embedded images; read images alongside. 3. **Scrambled-markdown rule** — if conversion quality is poor (heuristics in code: char-garbage ratio, table soup, near-empty output; + LLM judgment allowed), fall back to `…-as-pdf` and read the PDF pages.
4. After reading: append candidate facts to the **KB queue** (drained per email — the enforced replacement for "launch add-KB sub-agent after every read"; `state` blocks `done` while the queue is non-empty).

---

## 8. Knowledge base — OKF-native from day one

Fresh bundle at `data/kb/` per **OKF v0.1** (github.com/GoogleCloudPlatform/knowledge-catalog):
- **Every concept page**: YAML frontmatter with required `type` (person | team | organization | project | topic | decision | meeting-series | jargon | playbook), plus `title`, `description` (one-liner — also boosts BM25), `resource` (primary URI: outlook thread webLink, SharePoint URL…), `tags`, `timestamp` (+ `created`/`updated` as tolerated extra keys). Body sections free; external sources under `# Citations` ([1], [2]…); relationships as normal markdown links (relative or bundle-absolute `/people/…`).
- **Language**: pages are written in the user's primary language (from `about-me.md`); proper nouns, quoted excerpts and jargon expansions stay in their original language.
- **Reserved files**: per-folder `index.md` (progressive disclosure; **generated** by `kb-index-gen.ts` — derived data, never hand-curated) and root `log.md` (date-grouped, newest-first; every kb-curator write appends).
- **Categories = folders**; gardener may create new ones (§ below).
- **Add-to-KB rule** (kb-curator): read current structure + relevant `index.md`; a fact may update multiple pages; create page when no home exists; merge under `## Update YYYY-MM-DD` when page exists; slug collisions resolved, never duplicated. **Contradiction rule**: a write that contradicts an existing page is rejected by kb-curator and bounced back as a contradiction — only the main thread (after the AskUserQuestion truth gate) may overwrite, with the rationale logged.
- **Jargon rule**: any abbreviation/codename met anywhere (triage, research, docs, drafting) that is not already in `jargon/abbreviations.md` is queued (`kb-queue.ts --kind jargon`) and proposed to the user at wrap-up; accepted → added with expansion + one-line meaning + first-seen source. The jargon file is always-loaded (design principle 6) so decoding happens *before* any analysis.

### 8b. People & organizations (first-class citizens — `references/people-orgs.md`)

- **`people/<firstname-lastname>.md`** (`type: person`): frontmatter `emails:` (list — aliases resolved here), `title`, `org` (link to orgs/ page), `manager` (link), `assistant`/`delegates` (links — org-chart depth for reply-all/CC decisions), `tier` (leadership/peer/external…), `languages`, `last_contact`, `timezone`; body: focus areas, **`## Commitments`** (what was promised to/by this person, each entry dated + linked to its source thread), open threads, `## Update` history.
- **Commitments discipline**: the email-researcher reads the sender's (and key recipients') `## Commitments` before proposing strategies; a strategy or draft that would contradict a recorded commitment is flagged through the contradiction channel — never silently. New promises detected in threads are queued as KB facts targeting the person's Commitments section.
- **`orgs/<slug>.md`** (`type: organization`): `domains:` (email-domain → org mapping used by triage and voice bucketing), `relationship` (internal | client | partner | vendor), key people (links), related projects (links). Commercial data (contracts, budgets, deal status) is explicitly **out of scope** in v0.1.
- **`people/team-<slug>.md`** (`type: team`): purpose, roster as links to person pages, parent org link.
- **Identity resolution**: kb-curator matches people **by email address first** (any alias), slug second — the same human never gets two pages; org membership derived from domain when not explicit; Graph enrichment on creation (`get-user-manager`, title) when available.
- **Graph consistency** (gardener): every person's `org`/`manager`/`assistant`/`delegates` links resolve and manager *chains* are traversable (no broken chain); duplicate-person detection (same email, different slugs) → merge; `last_contact` refreshed from mail metadata; stale commitments (past-date, likely fulfilled) flagged for review; `orgs/index.md` and `people/index.md` regenerated grouped by organization.
- **qmd**: single collection `replu-kb`. Setup also offers to *remove or refresh* stale collections found in the shared index (currently `marcel-knowledge-base` 90d, `ask-marcel-canonical` 79d — they pollute unscoped searches); all plugin searches pass `-c replu-kb`.

**`kb-gardener` skill** (recurring — weekly scheduled task, plus on-demand):
- Phase 1 (code, auto-apply): `kb-lint.ts` — OKF conformance, broken links, staleness >180d, orphans, duplicate slugs; `kb-index-gen.ts` refresh; report.
- Phase 2 (LLM, plan-then-apply): curation plan — merge duplicates, **split oversized docs into new categories**, move pages, rewrite stale summaries — written as a plan file; user approves (interactive) or only the reversible subset auto-applies (unattended); execution via kb-curator so log/lint/index stay consistent.
- Ends with one `qmd update && qmd embed`.

---

## 9. Profile & session memory (NOT in the KB)

Everything in `data/profile/` — outside the qmd collection, invisible to search and to the gardener.

**`user.md` — living context about the user (always loaded).** Injected into context every session by the SessionStart hook, together with the jargon file. Content: role and current priorities, standing instructions ("always CC X on topic Y", "never commit dates for Z without checking"), answer preferences (length, tone, escalation habits), active constraints (travel, hours), recurring situations and how the user wants them handled. **Curated after every session** (run-level gate `user_md_reviewed`): add what the session taught, improve/compress existing entries, remove stale ones; the diff summary is shown in the wrap-up report. Hard cap ~150 lines so the always-loaded cost stays flat — the gardener flags it when it drifts toward the cap. Facts about *other* people/orgs never live here — they go to the KB; `user.md` is only about the user and how to work with them.

**Voice profile.** Loaded explicitly by drafting skills.
- **Sourcing**: `voice-extract.ts` — `search-mail-messages` KQL **`from:me` across ALL folders** (catches sent mail filed into project folders), sorted desc, keep the **last 50 substantive** messages (drop one-line acks <15 words, auto-replies, calendar responses, drafts), strip quoted chains + signature (port `extract-own-body.ts`).
- **Bootstrap** (decision 21): built fresh with this method, but seeded with the old plugin's **banned-patterns / anti-style list** (months of tuning the new analysis would otherwise relearn); the fresh analysis can only *extend* that list, never drop entries silently.
- **Analysis** (completing your open section — adopted from the proven method + additions):
  1. Bucket each message by recipient: upward (manager/leadership) / peers / external / broadcast (DL or >5 recipients) — org data via `get-my-manager`, `list-my-direct-reports`, domain comparison.
  2. Per bucket: greeting + sign-off forms, sentence length, formality, hedging, recurring phrases, format (bullets vs prose), CTA style, **language choice rules (FR/EN per recipient)**, 2–3 verbatim example excerpts.
  3. Banned-patterns list: AI tells absent from the real mail (basis of `draft-preflight.ts`, incl. em/en-dash HARD RULE).
  4. `about-me.md`: name, title, manager (`manager_confirmed` flag), reports, languages — user-corrected fields never overwritten on refresh.
- Signature (`signature.html/.txt` + logo) captured from sent mail; embedded in drafts.
- **Refresh policy — manual + drift alert**: no automatic rebuilds. Each run records how many approved drafts the user edited or rejected after preflight; when the rolling edit/reject rate crosses a threshold (>40% over the last 10 drafts), the wrap-up report recommends a `voice-profile` refresh. User-confirmed fields are always preserved on refresh.

---

## 10. Testing (every step independently — under the atelier discipline, §15)

- **Outside-in classicist TDD**: the SUT is the **use-case (primary port)** — scan-inbox, apply-draft, search-round… Domain pieces (state machine, rubric, OKF model) run **real** inside those tests; only secondary ports (CliRunner, GraphFetch, FileStore, Clock) get **hand-written fakes** in `src/test-helpers/` (with error-injection knobs). Never `mock` from `bun:test`. Test names are business scenarios ("an email whose thread already has a draft gets a PATCH, not a duplicate").
- Fakes are fed **recorded fixtures** (real CLI JSON envelopes captured once, replayed — no live Graph in tests).
- State machine: full transition table pinned (every illegal transition rejected) — via the use-cases that exercise it.
- `draft-preflight`, `kb-lint`, `voice-extract` stripping: golden-file tests.
- **Golden fixtures for LLM steps**: recorded sample threads → expected triage verdicts and package *shapes* (required fields, strategy count, citation presence), rubric-checked — catches prompt regressions, not just code regressions.
- Skills: tier-2 evals per skill (eval prompts + expected properties), runnable via skill-creator's eval harness (full benchmark runs deferred past v0.1).
- **Gates** (pre-commit, blocking): coverage 100% on `src/domain/**` + `src/use-cases/**`, 80% on composition/infra/presenter; Stryker mutation ≥90% on domain/use-cases; zero lint warnings; typecheck clean.
- `doctor.ts --json` doubles as the integration smoke test.

## 11. Reporting to the user (cross-cutting)

Every phase announces what it's doing and why in one line; every choice (rule-drop, strategy pick, low confidence, fallback to PDF) is stated, not silent. Final report per run; Coverage block lists anything skipped or failed.

## 12. Ported from ask-marcel-plugin (copy + adapt, keep provenance note)

`draft-preflight.ts` + anti-slop catalog, `extract-own-body.ts`, the old voice profile's **banned-patterns list** (decision 21), kb-curator & deep-doc-reader agent contracts, preflight-tools hook, scratch-retention convention, KQL keyword-ladder reference, probe-first auth convention. The old `create-reply-draft.ts` is NOT ported — its createReplyAll logic moves into the ask-marcel CLI itself (decision 19); its token-cache reader dies with it.

## 13. Explicitly out of scope (v0.1)

Sending mail (never), calendar writes, Teams chat, mailbox mutations (read/move/archive), auto-KB sweeps of the whole inbox (the old `inbox-to-kb` pattern can be added later using the same queue + watermark machinery), privacy capture filter / never-capture list (deliberately deferred — decision 20; capture is funneled through one code path, so adding it later is cheap).

## 14. Decisions

1. **Plugin name** — DECIDED: `ask-marcel` (this plugin is ask-marcel v2). ⚠ **Namespace collision**: the existing ask-marcel plugin is installed under the same name (`ask-marcel:*` skills). Before this one is installed, the old plugin must be disabled, uninstalled, or renamed — to be handled at ship time (a v0.1 interim name in `plugin.json` during development is fine; the manifest name is a one-line change).
2. **Inbox scope default** — DECIDED: unread-only, with `--scope all|unread|since-watermark` flag (cap 50).
3. **KB + profile language** — DECIDED: the user's primary language, auto-detected from sent mail during voice-profile build.
4. **git init** — DECIDED: repo initialized, `data/` gitignored (KB, profile, scratch never leave the machine).
5. **Triage default posture** — DECIDED: when in doubt, mark needs-reply; the user deselects at Gate 1.
6. **Phase 4 rhythm** — DECIDED: 4 gates per email as specced (contradictions → additions → strategy → approval).
7. **Search thresholds** — DECIDED: 70/40, max 5 rounds; revisit from run logs + evals.
8. **Person/org page scope** — DECIDED: track commitments & promises and org-chart depth (assistant/delegates/chains); communication-preferences and commercial context excluded from v0.1.
9. **KB seeding** — DECIDED: seed people & orgs from Graph at first setup (no mail backfill).
10. **Pre-research mode** — DECIDED: in v0.1 (unattended phases 1–3 on a schedule; see §2).
11. **Gardener cadence** — DECIDED: weekly scheduled + on-demand.
12. **Voice refresh** — DECIDED: manual + drift alert (edit/reject rate tracked per run).
13. **user.md size** — DECIDED: ~150-line cap, gardener flags drift.
14. **Agent models** — DECIDED: haiku for triage-scout/doc-reader/kb-curator; email-researcher inherits the session model.
15. **Caps & batches** — DECIDED: v0.1 defaults 25 (scope) / 4 (triage batch) / 2 (research batch) in `src/composition/config.ts`; raise to 50/8/4 once proven.
16. **Run reports** — DECIDED: permanent, one markdown per run in `data/reports/` (outside kb/, never indexed).
17. **Testing depth** — DECIDED: bun unit tests for every script + golden fixtures for LLM steps; full benchmark harness deferred.
18. **Engineering standard** — DECIDED: the **atelier** standard (`.agents/skills/atelier/`) governs all TypeScript in this repo (§15); the repo is born via **atelier-greenfield**, designs are stress-tested with **atelier-grill-me**, diffs audited with **atelier-review-me** before landing.

*Decisions 19–22 come from the atelier-grill-me interview (2026-07-03):*

19. **CLI-only Microsoft access** — DECIDED: the plugin uses the CLI at maximum and recodes nothing; it holds NO Graph client and NO token. The one missing write, `create-reply-draft` (Graph `createReplyAll`), is added to ask-marcel-office-cli before milestone M6 (v2.0.0 renamed the binary to `ask-marcel-office` but does not ship it yet). Rationale: the CLI is the single authenticated surface with exactly the right write policy; the old plugin's token-cache coupling dies.
20. **No privacy capture filter in v0.1** — DECIDED: all triaged content is capturable to the KB; gardener + manual review are the safety net (deferred, cheap to add later — §13).
21. **Voice bootstrap** — DECIDED: fresh build via the new `from:me` method, seeded with the old profile's banned-patterns list (carry, then extend-only).
22. **Build order** — DECIDED: the M0→M7 ladder (§16); usable value at M2 (triage table) and M3 (voice); the cross-repo CLI feature isolated at M4.

## 16. Build plan (M0→M7 — each milestone: small green confirmed commits + atelier-review-me before landing)

| M | Deliverable | Proves |
|---|---|---|
| M0 ✅ 2026-07-04 | atelier-greenfield scaffold, walking skeleton (one state-machine transition through a use-case port), all 8 gates green. Interim manifest name `email-replu` (→ `ask-marcel` at ship, §14.1) | The engineering machine works |
| M1 ✅ 2026-07-04 | Doctor + `setup` skill: CLI/qmd/bun checks + guided installs, M365 auth probe, OKF KB init, qmd collection, Graph people/org seeding (16 real pages). Schedule registration deferred to M7 with the scheduling machinery; known gap: entry scripts resolve `data/` from the working directory (run from repo root in v0.1) | Setup end-to-end on a clean machine |
| M2 🔄 2026-07-04 | `inbox-scan` + triage-scout agent + Gate 1 + run report. Deterministic layer landed (rules incl. FR calendar prefixes, envelopes, run bootstrap, file state store with baseDir, both CLIs — verified on the real inbox incl. illegal-transition refusal); agent + skill in flight | **First daily value: the triage table** |
| M3 | `voice-profile` skill (fresh + carried banned-list) + `draft-preflight` gate | Voice captured; drafts become possible in principle |
| M4 | CLI interlude: `create-reply-draft` in ask-marcel-office-cli (own repo, own TDD, shipped via npm; doctor version gate flips to ≥1.6) | The only cross-repo dependency, done before it blocks |
| M5 | Research pipeline: `fetch-email-bundle`, `read-doc`, search module (§6), email-researcher agent, packages + KB queue | Phase 3 works headless |
| M6 | Phase 4 interactive loop + `draft-apply` + KB queue drain + jargon/user.md wrap gates | **Full inbox-zero v0.1** |
| M7 | kb-gardener + pre-research mode + scheduling wiring | The recurring machine |

## 15. Engineering standard — atelier (binding for all code)

The four atelier skills installed at `.agents/skills/atelier*/` are the coding contract. What this means concretely for this repo (Bun-script variant):

- **One Bun package, Clean Architecture**: all logic in `src/{domain,use-cases,infra,presenter,composition}`; `scripts/` and `hooks/` are thin entry points that call the composition root. `console` is sanctioned only in those entries (their stdout IS the interface consumed by skills); everywhere else the injected `Logger` port.
- **Style hard rules**: no `class`, no `function` declarations, no `interface` (only `type`), const arrow functions with explicit return types, ESM only, plain `Error` only, no curried chains (DI factories exempt), Bun-only toolchain, `Bun.file`/`Bun.write` for file IO in production code.
- **`Result<T, E>`** on every IO port (`Promise<Result<T, PortError>>`, discriminated-union errors); use-cases return `Result<Summary, StepError>`; `try/catch` quarantined to `src/infra/**`, pure-domain native-thrower fallbacks, and `main`-level entries.
- **Branded types at trust boundaries**: SharePoint/web URLs extracted from mail bodies (untrusted → fetch sink), scratch paths built from email IDs (path-traversal sink), KB slugs (filesystem sink), email addresses at ingestion. Graph IDs traveling inside one trust zone stay plain strings (rule 12 carve-out).
- **TDD, confirmation-gated (rules 11 + 24)**: every feature starts with a proposed failing test **shown to the user for explicit sign-off before it is written**; tests are never created, edited, weakened, or deleted silently. SUT = use-case; hand-written fakes only for secondary ports; the `mock` namespace from `bun:test` is banned.
- **Gates**: eight-gate pre-commit (commit size ≤10 files/≤300 lines → package.json no-`latest` → gitleaks → tests → strict lint, zero warnings, no inline ignores ever → typecheck → coverage tiers 100/100/80 → Stryker mutation ≥90% domain/use-cases) + `commit-msg` hook enforcing Conventional Commits. New infra/composition/presenter files regenerate `scripts/coverage-preload.ts` in the same commit.
- **Process**: trunk-based on `main` in small green commits; **no commit or push without the user's explicit per-commit confirmation** (rule 25); `.claude/LESSONS.md` journal checked at session start, candidates proposed at session end; README audited before any task is declared done.
- **Repo birth**: the scaffold is executed by **atelier-greenfield** following `references/bun-typescript.md` verbatim — assets copied from `.agents/skills/atelier/assets/`, hooks wired via `core.hooksPath`, walking skeleton (one use-case through its primary port) proven green on all gates before the first code commit.

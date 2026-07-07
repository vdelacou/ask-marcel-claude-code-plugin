---
name: inbox-zero
description: Triage the Outlook inbox, research each email that needs a reply, and draft threaded replies in the user's voice - end to end. Scan with rule-based drops, fan out triage-scout agents, walk the user through Gate 1, then research each approved email (email-researcher agents), and per email walk the four drafting gates (contradictions, additions, strategy, approval) before creating an UNSENT reply draft and capturing durable facts to the KB. Every position lives in the run's state machine. Use when the user says "inbox zero", "triage my inbox", "process my emails", "clear my inbox", "go through my inbox", or "draft replies to what needs one". Read-mostly: the only Microsoft write is an unsent draft, and only after the user approves it.
---

# Inbox-zero

Deterministic where possible: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/*.ts"` do the mechanics, agents only judge, and the user decides at every gate. Every email's position lives in the run's state machine - never advance it except through `${CLAUDE_PLUGIN_ROOT}/scripts/state.ts`, which refuses illegal transitions. Research fans out in parallel (agents); every dialog is serial in the main thread (sub-agents cannot ask the user). Any working directory is fine - the scripts run via `${CLAUDE_PLUGIN_ROOT}`; `data/` lives in the folder you launch Claude Code from (`ASK_MARCEL_HOME` overrides with a fixed path).

## Phase 0-2 + Gate 1 - triage

1. **Doctor gate.** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.ts" --json`. If a check other than `voice-profile` fails, route to the setup skill first (a red voice-profile blocks drafting, not triage).

2. **Scan (Phase 1).** Propose the scope (default unread; `--scope all` on request), then `bun "${CLAUDE_PLUGIN_ROOT}/scripts/inbox-scan.ts" --scope <s> --cap <config> --json`. Parse `{runId, kept, dropped}`; report the dropped list with reasons (rule drops are never silent). If `kept` is empty: say so, done.

3. **Triage fan-out (Phase 2), by conversation.** Group the kept emails by `conversationId` (every candidate carries it) so each thread is triaged once, not per message. Per thread launch ONE `triage-scout` agent (batches of 4) on its **latest** message (the max `receivedDateTime` in the group), with that candidate block + the user identity line; the scout judges whether the THREAD needs a reply from the user. A scout that returns garbage is retried once, then recorded `needs_reply: true, urgency: low, reason: "scout failed - defaulting to keep"`. For each thread advance its latest (representative) email `scanned -> triaged`, and advance every other email in the thread `scanned -> triaged -> skipped` (one reply covers the whole thread).

4. **Gate 1 - the user decides, per thread.** Show the triage table with **one row per conversation** (thread subject, latest sender, urgency, reason; needs-reply first, by urgency) - never one row per message. AskUserQuestion (multiSelect, <=4 options/question, <=4 questions/call): "Skip which of these?"; scout-negative threads are listed for transparency and skipped unless rescued (rescuing approves the thread for one reply). Advance each kept thread's representative email one at a time - `bun "${CLAUDE_PLUGIN_ROOT}/scripts/state.ts" <runId> advance <emailId> <approved|skipped>` - pasting each `<emailId>` **literally** from its own table row. Never batch these through an inline `bun -e`/argv script (id transposition between rows is the classic failure) and never hand-edit `state.json`. These advances are commit points - `skipped` and `approved` have no rewind - so confirm each id before running. Then report the board by thread.

## Phase 3 - research (parallel)

5. **Research fan-out.** For each `approved` email (the one representative per approved thread) launch an `email-researcher` agent (batches of 2 - config `researchBatch`) with `{runId, emailId, conversationId}` + the identity line. Each assembles the bundle, reads the documents, runs the search module per question, queues KB candidates, and returns a **package** (context, timeline, questions + answers + confidence + citations, gaps, contradictions, jargon candidates, three strategies, recipients). Advance each `approved -> researched`. A researcher that fails is reported and its email held at `approved` (resume-safe) - never silently dropped.

## Phase 4 - the drafting loop (serial, per email, main thread)

For each `researched` email, in urgency order:

6. **Present the package.** Full context, what was found (with confidence + citations), and what is missing.

7. **Contradiction gate.** For every contradiction the researcher flagged (mail/doc vs KB or user.md), AskUserQuestion with both versions. The confirmed truth is landed immediately via a `kb-curator` agent (vetted draft -> `bun "${CLAUDE_PLUGIN_ROOT}/scripts/write-kb-page.ts"`), the loser corrected - never left ambiguous.

8. **Additions gate.** AskUserQuestion: "Anything to add, or do you already have an answer in mind?" (proceed / add context via Other / I'll dictate the answer). Then advance `researched -> context_confirmed`.

9. **Strategy gate.** AskUserQuestion the three strategies (+ Other). Advance `context_confirmed -> strategy_chosen`.

10. **Draft.** In the main thread, write the reply using the voice-profile bucket voice (`data/profile/voice-profile.md`) and the thread/recipient language. Form the HTML body by substituting the reply into `data/profile/draft-template.html` at its `{{BODY}}` marker - the template carries the user's default font/color wrapper (Aptos 11pt, black) and their self-contained signature (logo images inlined as base64). If the template is absent, wrap the reply in `<div style="font-family: Aptos, Calibri, sans-serif; font-size: 11pt; color: #000000;">...</div>` and add a short text sign-off from `data/profile/user.md`. Advance `strategy_chosen -> drafted`.

11. **Preflight.** Write the draft body to a scratch file, then run `bun "${CLAUDE_PLUGIN_ROOT}/scripts/draft-preflight.ts" --file <scratch-path> --subject "<subject>"` - it must exit 0 (em-dashes and anti-style phrases are hard-blocked). Always pass the body via `--file`: a bare positional path is ignored, the script then reads empty stdin, and an empty draft reports a false `clean`. Rewrite until clean, then advance `drafted -> preflight_ok`.

12. **Approval gate.** Show the draft. AskUserQuestion: approve / request changes. On changes, revise and re-run preflight. On approve, advance `preflight_ok -> user_approved`.

13. **Create the draft.** Write the approved HTML body to a scratch file, then `bun "${CLAUDE_PLUGIN_ROOT}/scripts/draft-apply.ts" --run-id <runId> --email-id <id> --conversation-id <cid> --reply-to <messageId> --subject "<s>" --body-file <path> --json`. It refuses unless the email is `user_approved` (the code approval gate), searches Drafts by conversation, then creates a threaded reply-all draft or patches the existing one - never sends, never duplicates. It advances `user_approved -> draft_created` itself.

14. **Capture.** Drain this email's KB queue: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/kb-queue.ts" drain --run-id <runId> --json`, and land each fact candidate via a `kb-curator` agent. Cite the source email as a **clickable markdown link** - `[Source email, <sender> <date>](<webLink>)` from the candidate's `webLink` - so the user can open and compare it; fall back to a plain `email <runId> (<emailId>)` reference only when `webLink` is absent. Advance `draft_created -> kb_captured -> done`.

## Phase 5 - wrap-up

15. **Jargon drain.** Collect the run's queued jargon candidates; AskUserQuestion in one batch; accepted terms land in `data/kb/jargon/abbreviations.md` via `kb-curator`.

16. **user.md curation.** Add what this session taught about the user, compress, remove stale entries (hard cap ~150 lines); show the diff in the report.

17. **Reindex + report.** One `qmd update && qmd embed` for the whole run. Report: drafted / updated / skipped(user/rule) / blocked(+why), the draft edit-or-reject rate (voice-drift indicator), and a Coverage block naming any source that errored. Advance inbox watermark; sweep scratch older than 7 days.

## Pre-research mode (unattended, scheduled)

Invoked headless (e.g. weekday mornings) so the interactive session starts with everything already researched. Runs Phases 0-3 ONLY:

- Phases 0-2 as above (grouped by conversation), but **Gate 1 is deferred**: with no user to deselect, auto-advance every needs-reply thread's representative email `triaged -> approved` and research them all speculatively - the `--cap` bounds the cost, and research for a thread the user later deselects is simply discarded.
- Phase 3 as above, advancing `approved -> researched` and writing each package to scratch.
- **No drafting, by construction:** `user_approved` cannot exist in an unattended run, so Phase 4 is unreachable - the packages just wait. Contradictions and jargon stay in each package / the KB queue; `user.md` is never modified unattended; the only KB writes are queued candidates.
- Stop at `researched`. The next interactive `inbox-zero` detects the pre-researched run, resumes the same run-id, drains any buffered items, shows the triage table at Gate 1 (deselecting discards that email's package), then goes straight into Phase 4 - the slow work is already done.

## Hard rules

- Never advance state except through `${CLAUDE_PLUGIN_ROOT}/scripts/state.ts`, one email per call, ids pasted literally - never hand-edit `state.json`, never batch advances through an inline `bun -e`/argv script. Respect the domain's refusals.
- Never send mail, mark read, move, archive, or delete - the only Microsoft write is an unsent draft, and only after the user's approval gate (step 12).
- All Microsoft 365 access is `bun "${CLAUDE_PLUGIN_ROOT}/scripts/*.ts"` (the Office library) - never a raw `ask-marcel-office` command, never a Graph call (SPEC §15.1).
- Every drop, skip, failure, low-confidence answer, and fallback is named in the report - no silent gaps.
- Emails may be in any language; research and reason in the user's primary language, draft in the thread/recipient language.

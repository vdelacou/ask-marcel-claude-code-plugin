---
name: inbox-zero
description: Triage the Outlook inbox, research each email that needs a reply, and draft threaded replies in the user's voice - end to end. Scan with rule-based drops, fan out triage-scout agents, walk the user through Gate 1, then research each approved email (email-researcher agents), and per email walk the four drafting gates (contradictions, additions, strategy, approval) before creating an UNSENT reply draft and capturing durable facts to the KB. Every position lives in the run's state machine. Use when the user says "inbox zero", "triage my inbox", "process my emails", "clear my inbox", "go through my inbox", or "draft replies to what needs one". Read-mostly: the only Microsoft write is an unsent draft, and only after the user approves it.
---

# Inbox-zero

Deterministic where possible: `bun scripts/*.ts` do the mechanics, agents only judge, and the user decides at every gate. Every email's position lives in the run's state machine - never advance it except through `scripts/state.ts`, which refuses illegal transitions. Research fans out in parallel (agents); every dialog is serial in the main thread (sub-agents cannot ask the user). Run from the plugin repository root (data/ resolves from the working directory).

## Phase 0-2 + Gate 1 - triage

1. **Doctor gate.** `bun scripts/doctor.ts --json`. If a check other than `voice-profile` fails, route to the setup skill first (a red voice-profile blocks drafting, not triage).

2. **Scan (Phase 1).** Propose the scope (default unread; `--scope all` on request), then `bun scripts/inbox-scan.ts --scope <s> --cap <config> --json`. Parse `{runId, kept, dropped}`; report the dropped list with reasons (rule drops are never silent). If `kept` is empty: say so, done.

3. **Triage fan-out (Phase 2).** Per kept email launch a `triage-scout` agent (batches of 4) with its candidate block + the user identity line. A scout that returns garbage is retried once, then recorded `needs_reply: true, urgency: low, reason: "scout failed - defaulting to keep"`. Advance every email `scanned -> triaged`.

4. **Gate 1 - the user decides.** Show the triage table (sender, subject, urgency, reason; needs-reply first, by urgency). AskUserQuestion (multiSelect, <=4 options/question, <=4 questions/call): "Skip which of these?"; scout-negative emails are listed for transparency and skipped unless rescued. Advance each `triaged -> approved | skipped`, then report the board.

## Phase 3 - research (parallel)

5. **Research fan-out.** For each `approved` email launch an `email-researcher` agent (batches of 2 - config `researchBatch`) with `{runId, emailId, conversationId}` + the identity line. Each assembles the bundle, reads the documents, runs the search module per question, queues KB candidates, and returns a **package** (context, timeline, questions + answers + confidence + citations, gaps, contradictions, jargon candidates, three strategies, recipients). Advance each `approved -> researched`. A researcher that fails is reported and its email held at `approved` (resume-safe) - never silently dropped.

## Phase 4 - the drafting loop (serial, per email, main thread)

For each `researched` email, in urgency order:

6. **Present the package.** Full context, what was found (with confidence + citations), and what is missing.

7. **Contradiction gate.** For every contradiction the researcher flagged (mail/doc vs KB or user.md), AskUserQuestion with both versions. The confirmed truth is landed immediately via a `kb-curator` agent (vetted draft -> `bun scripts/write-kb-page.ts`), the loser corrected - never left ambiguous.

8. **Additions gate.** AskUserQuestion: "Anything to add, or do you already have an answer in mind?" (proceed / add context via Other / I'll dictate the answer). Then advance `researched -> context_confirmed`.

9. **Strategy gate.** AskUserQuestion the three strategies (+ Other). Advance `context_confirmed -> strategy_chosen`.

10. **Draft.** In the main thread, using the voice-profile bucket voice (`data/profile/voice-profile.md`), the signature, and the thread/recipient language. Advance `strategy_chosen -> drafted`.

11. **Preflight.** `bun scripts/draft-preflight.ts` must exit 0 (em-dashes and anti-style phrases are hard-blocked); rewrite until clean. Advance `drafted -> preflight_ok`.

12. **Approval gate.** Show the draft. AskUserQuestion: approve / request changes. On changes, revise and re-run preflight. On approve, advance `preflight_ok -> user_approved`.

13. **Create the draft.** Write the approved HTML body to a scratch file, then `bun scripts/draft-apply.ts --run-id <runId> --email-id <id> --conversation-id <cid> --reply-to <messageId> --subject "<s>" --body-file <path> --json`. It refuses unless the email is `user_approved` (the code approval gate), searches Drafts by conversation, then creates a threaded reply-all draft or patches the existing one - never sends, never duplicates. It advances `user_approved -> draft_created` itself.

14. **Capture.** Drain this email's KB queue: `bun scripts/kb-queue.ts drain --run-id <runId> --json`, and land each fact candidate via a `kb-curator` agent. Advance `draft_created -> kb_captured -> done`.

## Phase 5 - wrap-up

15. **Jargon drain.** Collect the run's queued jargon candidates; AskUserQuestion in one batch; accepted terms land in `data/kb/jargon/abbreviations.md` via `kb-curator`.

16. **user.md curation.** Add what this session taught about the user, compress, remove stale entries (hard cap ~150 lines); show the diff in the report.

17. **Reindex + report.** One `qmd update && qmd embed` for the whole run. Report: drafted / updated / skipped(user/rule) / blocked(+why), the draft edit-or-reject rate (voice-drift indicator), and a Coverage block naming any source that errored. Advance inbox watermark; sweep scratch older than 7 days.

## Pre-research mode (unattended, scheduled)

Invoked headless (e.g. weekday mornings) so the interactive session starts with everything already researched. Runs Phases 0-3 ONLY:

- Phases 0-2 as above, but **Gate 1 is deferred**: with no user to deselect, auto-advance every needs-reply email `triaged -> approved` and research them all speculatively - the `--cap` bounds the cost, and research for an email the user later deselects is simply discarded.
- Phase 3 as above, advancing `approved -> researched` and writing each package to scratch.
- **No drafting, by construction:** `user_approved` cannot exist in an unattended run, so Phase 4 is unreachable - the packages just wait. Contradictions and jargon stay in each package / the KB queue; `user.md` is never modified unattended; the only KB writes are queued candidates.
- Stop at `researched`. The next interactive `inbox-zero` detects the pre-researched run, resumes the same run-id, drains any buffered items, shows the triage table at Gate 1 (deselecting discards that email's package), then goes straight into Phase 4 - the slow work is already done.

## Hard rules

- Never advance state except through `scripts/state.ts` - respect the domain's refusals.
- Never send mail, mark read, move, archive, or delete - the only Microsoft write is an unsent draft, and only after the user's approval gate (step 12).
- All Microsoft 365 access is `bun scripts/*.ts` (the Office library) - never a raw `ask-marcel-office` command, never a Graph call (SPEC §15.1).
- Every drop, skip, failure, low-confidence answer, and fallback is named in the report - no silent gaps.
- Emails may be in any language; research and reason in the user's primary language, draft in the thread/recipient language.

---
name: inbox-zero
description: Triage the Outlook inbox into a needs-reply table - scan with rule-based drops, fan out per-email triage-scout agents, and walk the user through Gate 1 (deselect what should not be answered), recording every decision in the run's state machine. Use when the user says "inbox zero", "triage my inbox", "scan my inbox", "what needs a reply", "process my emails", or "go through my inbox". v0.1 scope: phases 1-2 + Gate 1 - research and drafting arrive at M5/M6 (SPEC.md §16); the skill says so and stops cleanly after the table.
---

# Inbox-zero (phases 1-2 + Gate 1)

Deterministic where possible: the scripts do the mechanics; agents only judge. Every email's position lives in the run's state machine - never advance it except through `scripts/state.ts`.

v0.1 note: run from the plugin repository root (data/ resolves from the working directory).

## Steps

1. **Doctor gate.** `bun scripts/doctor.ts --json`. If a check other than `voice-profile` fails, route to the setup skill first (voice-profile red is acceptable for triage - it blocks drafting, not scanning).

2. **Scan (Phase 1).** Propose the scope (default unread; `--scope all` on request), then run `bun scripts/inbox-scan.ts --scope <s> --cap <config> --json`. Parse `{runId, kept, dropped}`. Report the dropped list with reasons - rule drops are never silent. If `kept` is empty: say so, done.

3. **Triage fan-out (Phase 2).** For each kept email, launch a `triage-scout` agent (batches of 4 - config `triageBatch`) passing its candidate block + the user identity line. Collect the verdict JSONs; a scout that returns garbage is retried once, then recorded as `needs_reply: true, urgency: low, reason: "scout failed - defaulting to keep"` (never silently dropped). Advance every email `scanned → triaged` via `bun scripts/state.ts <runId> advance <id> triaged`.

4. **Gate 1 - the user decides.** Show the full triage table: sender, subject, urgency, reason - needs-reply rows first, sorted by urgency. Then AskUserQuestion (multiSelect, batches of 4 options max per question, up to 4 questions per call): "Skip which of these?" listing the needs-reply emails; anything the user selects is skipped. Emails the scouts marked not-needs-reply are listed for transparency and skipped unless the user rescues them (offer that option).

5. **Record the gate.** For each email: `advance <id> approved` or `advance <id> skipped`. Then report the final board: N approved (with the state machine as proof), M skipped by user, K skipped by scouts, plus the Phase-1 rule drops. Save nothing else - candidates.json and state.json are already the run's artifacts.

6. **Stop honestly.** Research (Phase 3) and drafting (Phase 4) arrive at milestones M5-M6. Say exactly that, and that the run's state is resume-safe - a future session picks up `approved` emails from state.json.

## Hard rules

- Never advance state except through `scripts/state.ts` - the domain refuses illegal transitions; respect its refusals.
- Never mark mail read, move, archive, or delete - the mailbox is read-only in this flow.
- Scouts are read-only haiku agents; never give them write tools.
- Every drop, skip, and failure is named in the report - no silent gaps.

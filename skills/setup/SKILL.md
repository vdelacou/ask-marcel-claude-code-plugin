---
name: setup
description: Verify and complete the plugin setup so every other skill runs clean - the bun and qmd tools, the Microsoft 365 library session, the OKF knowledge base and its qmd collection, directory seeding, and the always-loaded user.md profile. Use when the user says "set up the plugin", "is the plugin ready", "check my setup", "plugin health check", "run the doctor", "onboard me", "first run", or when another skill fails on a missing prerequisite. Do NOT use for building the voice profile (that is the voice-profile skill) or for answering questions.
---

# Setup

Bring this machine to a state where every other skill runs clean. Idempotent - safe to re-run anytime. The doctor decides what is missing; you fix only what it reports, and every fix sits behind an explicit user yes.

v0.1 note: you can run this from any working directory - the entry scripts resolve their own location via `${CLAUDE_PLUGIN_ROOT}`. `data/` (KB, profile, scratch) lives in the folder you launch Claude Code from, not the plugin cache; set `ASK_MARCEL_HOME` to pin it to a fixed path instead.

## Steps

1. **Doctor first.** Run `bun "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.ts" --json` and parse the envelope (`{ok, ready, checks[]}`). If `bun` itself is missing the script cannot run - fall back to the fix table below, starting with bun.

2. **Present the board.** Show every check as a table (id, status, detail). Include the green ones - no silent gaps. If `ready: true`, say so and stop unless the user asked for something specific.

3. **Fix loop.** For each failing check, in report order, propose the fix with AskUserQuestion and run it only on yes. Never batch-run fixes unproposed; report anything the user skips.

   | check | fix to propose |
   |---|---|
   | `bun` | `curl -fsSL https://bun.sh/install | bash`, then append `export PATH="$HOME/.bun/bin:$PATH"` to `~/.zshrc` and have the user restart the shell. Verify with `bun --version`. |
   | `qmd` | `bun install -g @tobilu/qmd`. First embed later downloads GGUF models (~700 MB) - warn once. |
   | `auth` | `bun "${CLAUDE_PLUGIN_ROOT}/scripts/login.ts"` (the library's browser sign-in; one-time `bunx playwright install` for the browser binaries). NEVER run it preemptively - only when the auth check failed and the user said yes (probe-first discipline). Microsoft 365 access is library-only; there is no `ask-marcel-office` binary to install or version-check (SPEC §15.1). |
   | `kb` | `bun "${CLAUDE_PLUGIN_ROOT}/scripts/kb-init.ts"` - idempotent, never touches an existing KB. |
   | `qmd-collection` | `qmd collection add data/kb --name replu-kb`, then `qmd context add 'qmd://replu-kb' "OKF knowledge base of the inbox-zero reply plugin (ask-marcel v2). People, orgs, projects, topics, decisions, meetings, jargon captured from the user's mail. Query FIRST before falling through to Microsoft 365."`, then `qmd update -c replu-kb && qmd embed -c replu-kb`. |
   | `voice-profile` | Not fixable here - route the user to the voice-profile skill ("build my voice profile"), which analyzes their sent mail and writes `data/profile/voice-profile.md`. Do not fake the file. |
   | `user-md` | Step 4 below. |

4. **Seed user.md (interactive).** This is the always-loaded context about the user - never invent it. Ask up to three questions (AskUserQuestion, free text welcome): (a) role and current top priorities, (b) standing instructions for replies ("always CC X on topic Y", "never commit dates for Z"), (c) active constraints (working hours, travel, languages). Then Write `data/profile/user.md` from the template below, show it, and confirm. Keep it under ~30 lines now; the hard cap is 150 (SPEC.md decision 13). Facts about OTHER people never go here - they belong in the KB.

5. **Seed the KB from the directory.** Propose `bun "${CLAUDE_PLUGIN_ROOT}/scripts/kb-seed.ts"` - creates person/org pages from your manager, direct reports, and top colleagues; never overwrites; capped at 40 pages; every page logged in `data/kb/log.md`. Report created / skipped / dropped counts.

6. **Capture the email signature (optional).** Propose `bun "${CLAUDE_PLUGIN_ROOT}/scripts/capture-signature.ts" --json` - it lifts the `id="Signature"` block from a recent sent email, inlines the logo images as base64, and writes `data/profile/draft-template.html` (the inbox-zero drafting step wraps each reply in it, so drafts render in the user's font + signature). On a yes, run it and report `imageCount` + the path; on `no-signature`, say so - the user can send themselves a signature-only email and re-run. Note the caveat: base64 logos render for the user in Outlook but some recipient clients block `data:` images.

7. **Re-run the doctor.** Show the final board. Anything still failing gets one honest line on why (including the pending-milestone items).

8. **Offer scheduling (optional).** Propose two recurring runs via Claude Code scheduled tasks, each registered only on an explicit yes (never preemptively):
   - **Weekly kb-gardener** (e.g. Monday 07:00): runs the kb-gardener skill (lint + reindex + curation plan) to keep the KB healthy.
   - **Weekday pre-research** (a time the user picks, e.g. 06:30): runs `inbox-zero` in pre-research mode, so the interactive morning session starts with every needing-a-reply email already researched.
   Use the schedule mechanism (the `schedule` skill / scheduled tasks). Report what was registered; skip silently if the user declines.

## user.md template

```markdown
---
updated: {today}
source: setup
---

# {Name} - working context

## Role & priorities
- {role line}
- {2-4 current priorities}

## Standing instructions
- {each instruction as one line}

## Constraints
- {hours / travel / languages}
```

## Hard rules

- Probe-first: never run `bun "${CLAUDE_PLUGIN_ROOT}/scripts/login.ts"` unless the auth check failed AND the user approved.
- Never modify `data/kb/` by hand in this skill - only through the scripts, so the log and the index stay consistent.
- Never write `voice-profile.md` - that file belongs to the voice-profile skill.
- Every fix behind an explicit yes; every skipped fix named in the final report.

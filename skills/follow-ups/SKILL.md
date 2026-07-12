---
name: follow-ups
description: List the threads where the user's last message is still unanswered - "what am I waiting on?" - sorted by how long the silence has lasted, and help decide who to nudge. Read-only on the mailbox; drafting a nudge goes through the inbox-zero flow. Use when the user says "what am I waiting on", "who hasn't replied", "any follow-ups", "chase my emails", or "show pending threads".
---

# Follow-ups

One deterministic script, one table, your call. Any working directory is fine - `data/` resolves from where Claude Code was launched (`ASK_MARCEL_HOME` overrides).

## Steps

0. **Always-loaded context (principle 6).** Confirm `data/profile/user.md` + the jargon file are in context (the SessionStart hook prints them; Read them if not).

1. **List.** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/waiting-on.ts" --json` (default: silence >= 3 days over the last 100 mailbox messages; `--days`/`--top` to widen). It returns threads across ALL folders where the newest message is the user's.

2. **Present.** A table sorted as returned (longest silence first): days waiting / subject / who owes the reply. Note the caveat honestly: some threads legitimately end with the user's word (a "thanks", an FYI) - mark the ones whose last message asked a question or requested something as the real candidates, using the subjects and your context; when unsure, say so.

3. **Offer the nudge path.** For threads the user wants to chase, do NOT draft here: point them to inbox-zero ("the thread enters the normal gates - a nudge is a reply like any other") and, on request, register it there via the deferral mechanism (defer to today resurfaces it in the next run).

## Hard rules

- Read-only: no drafts, no sends, no mailbox mutations from this skill.
- Never auto-nudge; silence can be intentional. The user picks who to chase.

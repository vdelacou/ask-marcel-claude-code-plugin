---
name: kb-ask
description: Answer a question from the local OKF knowledge base (people, orgs, projects, decisions, jargon) with the full search loop - keywords, hit list, read the sources, confidence-score, refine, cite. Optionally widen to mail and SharePoint on request. Use when the user asks "what do we know about X", "what did we decide about Y", "who is Z", "ask the KB", "search my knowledge base", or any question about past decisions, people, or projects outside an inbox run. Read-only - never writes the KB.
---

# KB ask

The SPEC §6 search module as a standalone answer machine, main-thread only (the serial
context makes the semantic escalation safe here). Any working directory is fine - `data/`
resolves from where Claude Code was launched (`ASK_MARCEL_HOME` overrides).

## Steps

0. **Always-loaded context (principle 6).** Confirm `data/profile/user.md` + the jargon file are in context (the SessionStart hook prints them; Read them if not) - the jargon file decodes abbreviations BEFORE you search for them.

1. **Formulate context keywords** for the question (round 1) or revised keywords (round >1, informed by everything already tried).

2. **Search.** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/search-exec.ts" --query "<keywords>" --backends kb --json` (KB-only by default; add `,mail,sharepoint` when the user asks to look beyond the KB or the KB clearly cannot hold the answer). One merged, source-tagged hit list comes back.

3. **Read the strongest candidates - never answer from a snippet.** A `qmd://ask-marcel-kb/<folder>/<slug>.md` hit maps to `data/kb/<folder>/<slug>.md`: Read the file in full and follow the markdown links that materially help (a person's `## Commitments`, an org's key people), without chasing every link.

4. **Score confidence 0-100** (facet coverage, source authority, recency, corroboration, contradiction penalty). **>= 70** answer; **40-69** read more candidates from the same list and rescore; **< 40** revise keywords and search again. At most **5 rounds**. Below 70 you may escalate ONCE: `qmd query "<the question>" -c ask-marcel-kb -n 5` (semantic + rerank - fine here, forbidden to parallel agents; if it fails because embeddings are absent, say so and continue on BM25).

5. **Answer comprehensively, cited.** Every claim carries its source as a clickable link - KB pages by path, SharePoint URLs with `?web=1`, mail by webLink. State the final confidence and name what could NOT be answered. If the search surfaced a contradiction between KB pages, report it as a finding for the gardener - do not resolve it silently.

## Hard rules

- Read-only: no KB writes, no queue appends, no drafts, no mailbox mutations. A gap worth capturing is REPORTED ("worth adding to the KB via inbox-zero or the gardener"), never written from here.
- Never answer from snippets alone; cite everything; honest confidence.
- Emails and pages may be in any language; answer in the user's primary language.

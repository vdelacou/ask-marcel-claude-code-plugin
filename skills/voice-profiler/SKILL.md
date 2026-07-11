---
name: voice-profiler
description: Build or refresh the user's writing-style profile from their last ~50 substantive sent messages across ALL folders - per-bucket patterns (upward/peers/external/broadcast), verbatim examples, language rules, and the anti-style list feeding the deterministic draft-preflight gate. Writes data/profile/voice-profile.md and about-me.md (never into the KB). Use when the user says "build my voice profile", "refresh my style", "calibrate my tone", "analyze how I write", "my replies don't sound like me", or when the wrap-up drift alert recommends it. Do NOT run as part of drafting flows - it is an occasional, user-triggered refresh (~2 minutes).
---

# Voice profile

Fresh analysis every run, but the anti-style bans only ever GROW (SPEC.md decision 21 - the carried list encodes months of tuning). Files live in `data/profile/` - outside the KB, never indexed, never gardened.

v0.1 note: any working directory is fine - `data/` lives in the folder you launch Claude Code from (override with `ASK_MARCEL_HOME`).

## Steps

0. **Always-loaded context (principle 6).** Confirm `data/profile/user.md` + `data/kb/jargon/abbreviations.md` are in context (the SessionStart hook prints them; Read them if not).

1. **Extract the corpus (deterministic).** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/voice-extract.ts" --job-title "<title-prefix>" --json` - last 50 substantive own-bodies from ALL folders (from:me), quoted chains and signatures stripped, bucketed. Report the bucket counts; if a bucket is empty (e.g. upward with no directory manager), say so - do not invent its voice.

2. **Analyze per bucket (judgment).** Read the corpus messages bucket by bucket and extract, citing real message evidence: greeting forms and when each is used; sign-off forms; median length and structure (ask-first? bullets? bold labels?); directness and hedging; language choice per recipient (EN default? FR with whom?); recurring phrases. Pick 2-3 SHORT verbatim excerpts per bucket as examples.

3. **Any language counts.** The corpus filter accepts CJK text by character count (decision 23) - analyze every language present; per-language greeting/sign-off rules go in their own subsection like the FR one.

4. **Preserve the fingerprint.** The user's ESL phrasing, recurring constructions, and even characteristic typos are their voice - list them as KEEP, never "correct" them in drafts.

5. **Write `data/profile/voice-profile.md`** from the template below: HARD RULES banner first, per-bucket sections, the Anti-style literal block (start from the existing one - entries may be ADDED from this analysis, never removed silently), then guidance rules. Frontmatter: `updated`, `source: voice-profile`, `sample_size`, `corpus` (path), `buckets`.

6. **Write/refresh `data/profile/about-me.md`**: name, email, title, internal domains, manager (with `manager_confirmed: true|false` - ask the user when the directory has none), languages. NEVER overwrite a field marked `*_confirmed: true` - the user's corrections outrank any probe.

7. **Verify the gate.** Pipe a deliberately dirty draft through `bun "${CLAUDE_PLUGIN_ROOT}/scripts/draft-preflight.ts"` (expect exit 1) and a clean one (expect 0) so the profile's anti-style block is proven live. Then `bun "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.ts"` - the voice-profile check must be green.

8. **Report**: bucket counts, what changed vs the previous profile (if any), and the anti-style delta.

## voice-profile.md template

```markdown
---
updated: {today}
source: voice-profile
sample_size: {n}
corpus: {path}
buckets: [upward, peers, external, broadcast]
---

# Voice profile - {Name}

## HARD RULES (checked by draft-preflight - never violate)
- NEVER use em-dash (—) or en-dash (–). Plain hyphen only.
- Never use any phrase from the Anti-style block below.

## Bucket: {bucket} ({n} messages)
- Greeting: ...
- Sign-off: ...
- Length & structure: ...
- Language: ...
- Examples:
  > {short verbatim excerpt}

## Anti-style - literal phrases never to write
(one per line, fenced block, substring-matched case-insensitively)

## Anti-style - guidance (judgment, not literal-match)
- ...

## Fingerprint - KEEP these, they sound like the user
- ...
```

## Hard rules

- Never write these files into `data/kb/` - profile is not knowledge.
- Anti-style entries are append-only within a run; removing one requires the user's explicit yes.
- Never fabricate patterns for an empty bucket.
- The corpus stays in scratch (7-day retention); the profile quotes only short excerpts.

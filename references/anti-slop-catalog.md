# Anti-slop catalog

Generic AI-writing tells to strip from any draft in the user's voice. Adapted from [stop-slop](https://github.com/hardikpandya/stop-slop) (MIT), curated for short business mail and for **this** user.

## The one rule above all the others

**The user's measured voice wins.** This catalog removes *generic* AI tells, never the user's real habits. `voice-profile.md` is the source of truth for who he is on the page: terse, direct, ESL-natural ("How it's possible", "Confidential :", dropped articles, the occasional typo), comfortable with three-item lists. None of that is slop. If a rule here would sand off something `voice-profile.md` says to keep, the profile wins and you drop the rule. When in doubt, match him, not a generic "good prose" ideal.

So the layers, cheapest to richest:

1. **Deterministic literal block below** — `draft-preflight.ts` reads it and fails the draft on a match. Narrow on purpose: only tells with near-zero false-positive risk in real mail. A false block costs a needless rewrite and erodes trust in the gate, so borderline phrases stay *out* of this block and live in the guidance instead.
2. **Judgment guidance** — the structural tells a substring can't catch. Apply by reading the draft. Explained, not barked, so you can tell a real instance from a false alarm.
3. **Scoring rubric** — a 15-second gut-check before you show the draft.

## Anti-slop — literal tells (universal, deterministic)

`draft-preflight.ts` reads the first fenced block under this heading verbatim: one phrase per line, no list markers, matched case-insensitively as a substring. These are corporate/AI tells that do not appear in the user's sent mail, so flagging them is safe. **English only** — French and Chinese tells don't substring-match cleanly and would risk catching legitimate phrasing, so they're a known gap handled by the guidance + rubric below, not here.

```
Here's the thing
The uncomfortable truth
Let me be clear
Needless to say
It goes without saying
It's worth noting
It's important to note
It is important to note
At the end of the day
Let that sink in
Make no mistake
cannot be overstated
can't be overstated
circle back
move the needle
low-hanging fruit
boil the ocean
game-changer
game changer
paradigm shift
best-in-class
win-win
table stakes
synergy
Let me walk you through
In today's fast-paced
```

## Judgment guidance (not substring-matchable)

These are the tells that need a human read. Each is a *default to question*, not an automatic delete: name the real instance, then fix it. If it's actually the user's voice, leave it.

### False agency — name the actor

AI hides who did something by giving the action to an object. A decision doesn't "emerge"; someone decided. A complaint doesn't "become a fix"; someone fixed it. This matters in mail because the recipient wants to know *who* — who decided, who owns it, who to chase. Name them.

- "the decision emerged" → "Sam signed off Tuesday"
- "the conversation moved toward" → "we agreed to"
- "the data tells us" → "the Q3 numbers show"

### Vague declaratives — name the specific thing

A sentence that announces importance without saying *what* is filler. "The implications are significant" tells the reader nothing. Cut it, or replace it with the implication.

- "The reasons are structural" → the actual reason
- "This has major implications" → the actual implication
- "The stakes are high here" → what's at stake

### Binary contrasts and negative listing — state it straight

"It's not X, it's Y." "The problem isn't X. It's Y." The reversal is telegraphed; the reader sees it coming. Just state Y. Same for listing what something *isn't* before saying what it is — the runway adds nothing in an email.

- "This isn't about cost, it's about trust" → "This is about trust"
- "Not a delay. A reset." → "This is a reset"

### Passive voice that hides the actor

"Mistakes were made." "The decision was reached." Mail is about accountability and next steps; the actor is the point. Find them and put them first. (Passive is fine when the actor is genuinely unknown or irrelevant.)

### Rhetorical scaffolding

"What if I told you…", "Here's what I mean:", "Think about it." These announce an insight instead of delivering it, and they read as condescending in mail. Make the point.

### Adverb and hedge crutches

`voice-profile.md` already bans the hedges (`I think`, `probably`, `maybe`). On top of that, watch the empty intensifiers AI leans on: *really, simply, just, actually, genuinely, literally, fundamentally*. They're not deterministically blocked because "just" and "actually" are often legitimate ("I just sent it", "actually, yes") — so judge each one. If it adds no meaning, cut it.

## What this catalog deliberately does NOT import

stop-slop is written for essays and LinkedIn posts. Several of its rules would fight terse business mail or the user's real voice, so they're **out**:

- **"No three-item lists" / "two beats three"** — he uses them; lists are clear in mail.
- **"No Wh- sentence starters"** — too aggressive; "When can you send it?" is fine.
- **"Vary every paragraph ending" / "cut anything quotable"** — essay craft, irrelevant to a five-line reply.
- **"No em-dash"** — already enforced harder by the HARD RULES + `draft-preflight.ts`; not this catalog's job.

## Scoring rubric — a 15-second gut-check

Before showing a draft, rate it 1–5 on each. This is a *prompt to revise*, not a gate (the only hard gates are the deterministic checker and the fact-trace). If a dimension is clearly weak, tighten it — but never trade away a voice-match to chase a number.

| Dimension | Ask yourself |
|---|---|
| **Directness** | Does it open with the ask or the answer, or warm up first? |
| **Specificity** | Named things, people, numbers — or vague declaratives and false agency? |
| **Voice-match** | Does it sound like him (terse, direct, ESL-natural, no hedging, right bucket) — or like generic polished AI? |
| **Density** | Anything cuttable without losing meaning? |

A draft that's direct, specific, in-voice, and dense is done. One that reads smooth but generic has failed the only test that matters: it doesn't sound like him.

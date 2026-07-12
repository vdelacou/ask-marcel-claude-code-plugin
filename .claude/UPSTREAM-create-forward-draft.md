# Upstream change request: `create-forward-draft` in ask-marcel-office-cli

Self-contained brief for a session opened in `~/Documents/CODE/ask-marcel/ask-marcel-office-cli`
(that repo's CLAUDE.md and gates govern the work). Requested by the ask-marcel plugin
(SPEC decision 19: the plugin reaches M365 only through this library's command registry,
so a missing operation is added HERE, never worked around with raw Graph).

## Why

The plugin's email-researcher proposes three reply stances per email: commit / clarify /
redirect. Redirect in real life is usually a FORWARD with a comment ("Bob owns this,
forwarding") - but the registry has `create-reply-draft` and `create-mail-draft` only, so
the plugin can only reply on-thread and the redirect stance dies in chat. One new command
closes it. Same never-send guarantee: the result is an UNSENT draft in Drafts.

## The command

Mirror `src/use-cases/commands/create-reply-draft.ts` exactly (same file layout, same
two-step shape, same guard, same meta style). Name: **`create-forward-draft`**.

Schema (zod, same conventions):

| key | required | notes |
|---|---|---|
| `forwardMessageId` | yes | the message being forwarded; alias `--id` like reply's `replyToMessageId` |
| `toRecipients` | yes | comma-separated addresses; reuse the `parseRecipients` helper `create-mail-draft` uses. Required: a forward without a recipient is not actionable |
| `ccRecipients` | no | comma-separated |
| `bodyContent` | yes | the comment placed above the quoted message |
| `bodyContentType` | no | `Text` \| `HTML`, default `Text` (same as reply) |
| `subject` | no | override; Graph inherits `FW:` + original subject when absent |

Execution, mirroring the reply command's two-step rationale verbatim:

1. `POST /me/messages/{forwardMessageId}/createForward` with an **empty body** - Graph
   mints the forward draft (FW: subject, quoted history). Do NOT use the `comment`/
   `toRecipients` parameters of createForward itself: comment-based creation renders
   poorly (the documented reason reply uses PATCH) and keeping both commands on one
   pattern keeps the tests and docs symmetric.
2. Same `isUnsentDraft` defense-in-depth guard: refuse to touch anything that is not
   `{ id, isDraft: true }`.
3. `PATCH /me/messages/{draftId}` with `body`, `toRecipients` (parsed), `ccRecipients`
   when given, `subject` when given.

Graph docs: https://learn.microsoft.com/en-us/graph/api/message-createforward
Scopes: `Mail.ReadWrite` - already requested for the reply command, so
`graph-scopes.ts` gains the command name but NO new scope.

## Meta (summary draft - adjust to house voice)

> Create an UNSENT forward draft of an existing message. POST
> /me/messages/{id}/createForward mints the draft (FW: subject, quoted history), then
> PATCH places the comment above the quote and sets the recipients. The draft is saved in
> Drafts and can be reviewed, edited, and sent from any Outlook client; the CLI still
> cannot send.

Category `mail`, `graphMethod: 'POST'`, path template
`/me/messages/{forward-message-id}/createForward (then PATCH the returned draft)`.

## Tests (mirror `create-reply-draft.test.ts` scenario for scenario)

- Validation: missing `forwardMessageId` / `toRecipients` / `bodyContent` each err
  `validation_error`; bad `bodyContentType` rejected.
- Happy path: asserts the POST path, then the PATCH payload byte-for-byte - recipients
  parsed into `[{ emailAddress: { address } }]`, body contentType defaulting to `Text`,
  no `subject`/`ccRecipients` keys when not given.
- Subject + cc given: both land in the PATCH.
- A createForward response that is not an unsent draft is refused with the same
  refusing-to-patch `api_error` shape as reply.
- The PATCH failure propagates (no swallow).

## Registration & release

- Register in `src/use-cases/commands/index.ts` (alphabetical) + `graph-scopes.ts`.
- CHANGELOG entry; bump the minor version; `npm publish`.
- Everything through that repo's own pre-commit gates.

## Post-publish follow-up (plugin side - do NOT do in the CLI repo)

The plugin (`ask-marcel-claude-code-plugin`) will then: bump its dependency, add a
`forward-apply` path guarded by the same `user_approved` state gate as draft-apply, and
wire the researcher's redirect stance to it. Tracked on the plugin's audit board
(".claude/AUDIT-2026-07-11.md" > Roadmap batch 1 > Forward-draft: OPEN).

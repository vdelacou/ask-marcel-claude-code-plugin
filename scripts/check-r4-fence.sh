#!/usr/bin/env bash
#
# R4 fence (SPEC.md §15.1): skills, agents, and scripts reach Microsoft 365 ONLY through
# `bun scripts/*.ts` (the Office library) - never a raw `ask-marcel-office` binary command.
#
# Matches `ask-marcel-office ` followed by a command verb (`login`, `logout`, `update`, or any
# hyphenated command like `convert-mail-to-markdown`). This deliberately does NOT match:
#   - the library package name `ask-marcel-office-cli` (a `-`, not a space, follows `office`)
#   - prose such as "never a raw ask-marcel-office command" (`command` has no hyphen and is not a verb)
#
set -euo pipefail

if hits=$(grep -rnE 'ask-marcel-office (login|logout|update|[a-z][a-z]*-[a-z-]+)' skills/ agents/ scripts/ 2>/dev/null); then
  echo "R4 fence: a skill / agent / script invokes the ask-marcel-office binary (SPEC.md §15.1 R4):" >&2
  echo "$hits" >&2
  echo "Reach Microsoft 365 through 'bun scripts/*.ts' (the Office library), never the binary." >&2
  exit 1
fi

echo "  R4 fence: no ask-marcel-office binary invocations in skills / agents / scripts."
exit 0

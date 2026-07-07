import { describe, expect, test } from 'bun:test';

import { detectDraftFindings, hasNoDraftSource, isBlankDraft, parseAntiStyle } from './draft-preflight.ts';

const PROFILE = `# Voice

## Anti-style — literal phrases never to write

Some prose.

\`\`\`
I hope this email finds you well
Per my last email
\`\`\`

## Other heading

\`\`\`
not a phrase block
\`\`\`
`;

describe('draft preflight', () => {
  test('an em or en dash fails the gate naming the offending line', () => {
    expect(detectDraftFindings('ok line\n  bad — dash here  \nworse – dash', [])).toEqual([
      { line: 2, kind: 'em-dash', detail: 'bad — dash here' },
      { line: 3, kind: 'en-dash', detail: 'worse – dash' },
    ]);
  });

  test('a banned phrase fails case-insensitively', () => {
    const phrases = parseAntiStyle(PROFILE);

    expect(phrases).toEqual(['I hope this email finds you well', 'Per my last email']);
    expect(parseAntiStyle('```\nstray before any heading\n```\n## ANTI-SLOP CAPS\n```text\n  padded phrase  \n\nsecond\n```')).toEqual(['padded phrase', 'second']);
    expect(parseAntiStyle('')).toEqual([]);
    expect(detectDraftFindings('Hello,\nI HOPE THIS EMAIL FINDS YOU WELL today', phrases)).toEqual([{ line: 2, kind: 'phrase', detail: 'I hope this email finds you well' }]);
  });

  test('a clean draft passes with no findings', () => {
    expect(detectDraftFindings('Hello Jane,\nConfirmed for Ledger - aligned with the group choice.\nVincent', parseAntiStyle(PROFILE))).toEqual([]);
  });

  test('a blank draft is not clean - it is a preflight error, so an empty read cannot pass as clean', () => {
    // the false-clean bug: an empty body (positional path ignored, empty stdin) must never report clean
    expect(isBlankDraft('')).toBe(true);
    expect(isBlankDraft('   \n\t ')).toBe(true);
    expect(isBlankDraft('Re: x\nhello')).toBe(false);
  });

  test('there is no draft source when no --file is given and stdin is a TTY (would hang / read nothing)', () => {
    expect(hasNoDraftSource(false, true)).toBe(true);
    // a piped stdin (not a TTY) or an explicit --file is a real source
    expect(hasNoDraftSource(false, false)).toBe(false);
    expect(hasNoDraftSource(true, true)).toBe(false);
    expect(hasNoDraftSource(true, false)).toBe(false);
  });
});

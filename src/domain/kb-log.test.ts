import { describe, expect, test } from 'bun:test';

import { appendLogEntries } from './kb-log.ts';

const SEEDED = `# Log

## 2026-07-04

- kb-init: created the OKF skeleton
`;

describe('kb log', () => {
  test('entries land at the top of an existing today-section', () => {
    const updated = appendLogEntries(SEEDED, '2026-07-04', ['kb-seed: people/eloise-dupont.md', 'kb-seed: orgs/adama-development.md']);

    expect(updated).toBe(`# Log

## 2026-07-04

- kb-seed: people/eloise-dupont.md
- kb-seed: orgs/adama-development.md
- kb-init: created the OKF skeleton
`);
  });

  test('a new day opens its own section above previous days', () => {
    const updated = appendLogEntries(SEEDED, '2026-07-05', ['kb-seed: people/john-doe.md']);

    expect(updated).toBe(`# Log

## 2026-07-05

- kb-seed: people/john-doe.md

## 2026-07-04

- kb-init: created the OKF skeleton
`);
  });

  test('a log without a header is rebuilt rather than corrupted', () => {
    const updated = appendLogEntries('', '2026-07-04', ['kb-seed: people/john-doe.md']);

    expect(updated).toBe(`# Log

## 2026-07-04

- kb-seed: people/john-doe.md
`);
  });
});

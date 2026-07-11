import { describe, expect, test } from 'bun:test';

import { appendToQueue, isQueueEmpty, matchesFilter, parseQueue, serializeCandidate, splitQueue } from './kb-queue.ts';
import type { KbCandidate } from './kb-queue.ts';

describe('kb-queue', () => {
  test('a fact round-trips through serialize and parse', () => {
    const fact: KbCandidate = {
      kind: 'fact',
      emailId: 'm1',
      webLink: 'https://outlook.office365.com/owa/?ItemID=m1',
      folder: 'people',
      slug: 'jane-boss',
      title: 'Jane Boss',
      content: 'VP of Retail',
      rationale: 'named as approver in the thread',
    };
    // the webLink round-trips so the KB citation can link back to the source email
    expect(parseQueue(serializeCandidate(fact))).toEqual([fact]);
  });

  test('a jargon term round-trips', () => {
    const jargon: KbCandidate = { kind: 'jargon', term: 'QUICK OB', guessedMeaning: 'fast onboarding', context: 'from the PROJECT ORBIT thread' };
    expect(parseQueue(serializeCandidate(jargon))).toEqual([jargon]);
  });

  test('appendToQueue accumulates candidates as ordered JSONL lines', () => {
    const a: KbCandidate = { kind: 'jargon', term: 'A', guessedMeaning: '', context: '' };
    const b: KbCandidate = { kind: 'jargon', term: 'B', guessedMeaning: '', context: '' };

    const queue = appendToQueue(appendToQueue('', a), b);

    expect(parseQueue(queue).map((candidate) => (candidate.kind === 'jargon' ? candidate.term : 'fact'))).toEqual(['A', 'B']);
  });

  test('malformed lines are skipped and valid candidates keep their defaults', () => {
    const content = [
      'not json at all',
      JSON.stringify({ kind: 'fact', emailId: 'm1', folder: 'topics', slug: 's', title: 't', content: 'c' }),
      JSON.stringify({ kind: 'unknown-kind' }),
      JSON.stringify({ kind: 'fact', folder: 'x' }),
      JSON.stringify('a bare string'),
      JSON.stringify({ kind: 'jargon' }),
      '',
      JSON.stringify({ kind: 'jargon', term: 'OKF' }),
    ].join('\n');

    const parsed = parseQueue(content);

    expect(parsed).toHaveLength(2);
    // a fact with no rationale defaults it to empty
    expect(parsed[0]).toEqual({ kind: 'fact', emailId: 'm1', folder: 'topics', slug: 's', title: 't', content: 'c', rationale: '' });
    // a jargon term with only its term defaults meaning and context
    expect(parsed[1]).toEqual({ kind: 'jargon', term: 'OKF', guessedMeaning: '', context: '' });
  });

  test('an empty or whitespace-only queue parses to nothing', () => {
    expect(parseQueue('')).toEqual([]);
    expect(parseQueue('\n\n  \n')).toEqual([]);
  });

  test('a fact is dropped when any single required field is missing', () => {
    const complete: Record<string, string> = { kind: 'fact', emailId: 'm1', folder: 'topics', slug: 's', title: 't', content: 'c' };
    const without = (field: string): Record<string, string> => Object.fromEntries(Object.entries(complete).filter(([key]) => key !== field));
    for (const field of ['emailId', 'folder', 'slug', 'title', 'content']) {
      expect(parseQueue(JSON.stringify(without(field)))).toEqual([]);
    }
    // with every required field present it parses (the guard rejects only genuinely incomplete facts)
    expect(parseQueue(JSON.stringify(complete))).toHaveLength(1);
  });

  test('a jargon candidate is dropped when its term is missing', () => {
    expect(parseQueue(JSON.stringify({ kind: 'jargon', guessedMeaning: 'x', context: 'y' }))).toEqual([]);
    expect(parseQueue(JSON.stringify({ kind: 'jargon', term: 'has-term' }))).toHaveLength(1);
  });

  const FACT_M1: KbCandidate = { kind: 'fact', emailId: 'm1', folder: 'people', slug: 'jane', title: 'Jane', content: 'VP', rationale: '' };
  const FACT_M2: KbCandidate = { kind: 'fact', emailId: 'm2', folder: 'orgs', slug: 'acme', title: 'Acme', content: 'vendor', rationale: '' };
  const JARGON_OKF: KbCandidate = { kind: 'jargon', term: 'OKF', guessedMeaning: 'Open Knowledge Format', context: 'kb' };
  const QUEUE = `${serializeCandidate(FACT_M1)}\n${serializeCandidate(FACT_M2)}\n${serializeCandidate(JARGON_OKF)}\n`;

  test('an emailId filter matches only that email - jargon has no emailId and never matches it', () => {
    expect(matchesFilter(FACT_M1, { emailId: 'm1' })).toBe(true);
    expect(matchesFilter(FACT_M2, { emailId: 'm1' })).toBe(false);
    expect(matchesFilter(JARGON_OKF, { emailId: 'm1' })).toBe(false);
    // a kind filter is orthogonal, and the empty filter matches everything
    expect(matchesFilter(JARGON_OKF, { kind: 'jargon' })).toBe(true);
    expect(matchesFilter(FACT_M1, { kind: 'jargon' })).toBe(false);
    expect(matchesFilter(JARGON_OKF, {})).toBe(true);
  });

  test("splitQueue takes one email's facts out and leaves the rest byte-stable for the next drain", () => {
    const { drained, remaining } = splitQueue(QUEUE, { emailId: 'm1' });

    expect(drained).toEqual([FACT_M1]);
    expect(remaining).toBe(`${serializeCandidate(FACT_M2)}\n${serializeCandidate(JARGON_OKF)}\n`);
  });

  test('splitQueue with no filter drains everything and drops malformed lines from the remainder', () => {
    const { drained, remaining } = splitQueue(`garbage line\n${QUEUE}`, {});

    expect(drained).toEqual([FACT_M1, FACT_M2, JARGON_OKF]);
    expect(remaining).toBe('');
  });

  test('isQueueEmpty reflects parseable candidates, not raw bytes', () => {
    expect(isQueueEmpty('')).toBe(true);
    expect(isQueueEmpty('malformed only\n')).toBe(true);
    expect(isQueueEmpty(QUEUE)).toBe(false);
  });
});

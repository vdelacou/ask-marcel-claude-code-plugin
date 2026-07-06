import { describe, expect, test } from 'bun:test';

import { appendToQueue, parseQueue, serializeCandidate } from './kb-queue.ts';
import type { KbCandidate } from './kb-queue.ts';

describe('kb-queue', () => {
  test('a fact round-trips through serialize and parse', () => {
    const fact: KbCandidate = {
      kind: 'fact',
      emailId: 'm1',
      folder: 'people',
      slug: 'jane-boss',
      title: 'Jane Boss',
      content: 'VP of Retail',
      rationale: 'named as approver in the thread',
    };
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
});

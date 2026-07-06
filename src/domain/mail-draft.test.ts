import { describe, expect, test } from 'bun:test';

import { extractDraftId, extractFirstMessageId } from './mail-draft.ts';

describe('extractDraftId', () => {
  test('reads the id from a draft message resource', () => {
    expect(extractDraftId({ id: 'AAMk-draft-1', subject: 'RE: Q3' })).toBe('AAMk-draft-1');
  });

  test('a non-record, or a resource without an id, has no draft id', () => {
    expect(extractDraftId('nope')).toBeUndefined();
    expect(extractDraftId({ subject: 'no id' })).toBeUndefined();
  });
});

describe('extractFirstMessageId', () => {
  test('returns the id of the first message in a drafts listing', () => {
    expect(extractFirstMessageId({ value: [{ id: 'd1', conversationId: 'c1' }, { id: 'd2' }] })).toBe('d1');
  });

  test('skips leading non-record entries to the first real message', () => {
    expect(extractFirstMessageId({ value: ['nope', null, { id: 'd9' }] })).toBe('d9');
  });

  test('an empty listing, non-array value, or non-record payload has no message id', () => {
    expect(extractFirstMessageId({ value: [] })).toBeUndefined();
    expect(extractFirstMessageId({ value: 'nope' })).toBeUndefined();
    expect(extractFirstMessageId('nope')).toBeUndefined();
  });
});

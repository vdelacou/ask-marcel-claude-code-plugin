import { describe, expect, test } from 'bun:test';

import { findBlockedTerm, parseNeverCapture } from './capture-filter.ts';

describe('capture-filter', () => {
  test('the list format matches blocked-senders: one term per line, blanks and # comments ignored, entries trimmed', () => {
    expect(parseNeverCapture('# people\nJane Restricted\n\n  acme-secret.com  \n# codenames\nPROJECT NIGHTFALL\n')).toEqual([
      'Jane Restricted',
      'acme-secret.com',
      'PROJECT NIGHTFALL',
    ]);
    expect(parseNeverCapture('')).toEqual([]);
  });

  test('matching is case-insensitive substring and returns the FIRST blocked term found', () => {
    const terms = ['jane restricted', 'acme-secret.com'];
    expect(findBlockedTerm('Meeting notes: JANE RESTRICTED approved the budget', terms)).toBe('jane restricted');
    expect(findBlockedTerm('see https://ACME-SECRET.com/report and jane restricted', terms)).toBe('jane restricted');
    expect(findBlockedTerm('a perfectly ordinary page', terms)).toBeUndefined();
    expect(findBlockedTerm('anything at all', [])).toBeUndefined();
  });

  test('any-language literals match as substrings - CJK needs no word boundaries', () => {
    expect(findBlockedTerm('会议记录：王伟批准了预算', ['王伟'])).toBe('王伟');
    expect(findBlockedTerm('projet confidentiel Lumière', ['lumière'])).toBe('lumière');
  });
});

import { describe, expect, test } from 'bun:test';

import { extractSharepointLinks, isResolvedLink, withWebParam } from './sharepoint-links.ts';

// extractSharepointLinks' malformed-shape handling and the resolved/errored split are swallowed by the
// use-case (download vs skip), so the domain contract is pinned directly here.
describe('extractSharepointLinks', () => {
  test('splits resolved links (driveId + itemId) from errored ones, defaulting missing name and webUrl', () => {
    const data = {
      links: [
        { url: 'https://x/a', driveId: 'd1', itemId: 'i1', name: 'Spec.docx', webUrl: 'https://x/spec' },
        { url: 'https://x/b', driveId: 'd2', itemId: 'i2' },
        { url: 'https://x/c', error: 'access denied' },
        { url: 'https://x/d', driveId: 'd3' },
      ],
    };

    expect(extractSharepointLinks(data)).toEqual([
      { url: 'https://x/a', name: 'Spec.docx', webUrl: 'https://x/spec?web=1', driveId: 'd1', itemId: 'i1' },
      { url: 'https://x/b', name: '(unnamed)', webUrl: 'https://x/b?web=1', driveId: 'd2', itemId: 'i2' },
      { url: 'https://x/c', error: 'access denied' },
      { url: 'https://x/d', error: 'unresolved' },
    ]);
  });

  test('skips entries without a url and non-record entries', () => {
    const data = { links: [{ driveId: 'd', itemId: 'i' }, 'not-a-record', null, { url: 'https://x/keep', driveId: 'd', itemId: 'i' }] };
    expect(extractSharepointLinks(data)).toHaveLength(1);
  });

  test('a non-record payload or a non-array links field yields an empty list', () => {
    expect(extractSharepointLinks('nope')).toEqual([]);
    expect(extractSharepointLinks(null)).toEqual([]);
    expect(extractSharepointLinks({})).toEqual([]);
    expect(extractSharepointLinks({ links: 'not-an-array' })).toEqual([]);
  });
});

describe('isResolvedLink', () => {
  test('a link with driveId is resolved; an errored link is not', () => {
    expect(isResolvedLink({ url: 'https://x/a', name: 'n', webUrl: 'https://x/a', driveId: 'd', itemId: 'i' })).toBe(true);
    expect(isResolvedLink({ url: 'https://x/b', error: 'boom' })).toBe(false);
  });
});

describe('withWebParam', () => {
  test('forces the browser view on a SharePoint link, idempotently and respecting a query string', () => {
    expect(withWebParam('https://x/doc.docx')).toBe('https://x/doc.docx?web=1');
    expect(withWebParam('https://x/doc.docx?e=abc')).toBe('https://x/doc.docx?e=abc&web=1');
    expect(withWebParam('https://x/doc.docx?web=1')).toBe('https://x/doc.docx?web=1');
    expect(withWebParam('https://x/doc.docx?csf=1&web=1&e=z')).toBe('https://x/doc.docx?csf=1&web=1&e=z');
    expect(withWebParam('')).toBe('');
  });
});

import { describe, expect, test } from 'bun:test';

import { dedupeHits, extractKbHits, extractMailHits, extractSharepointHits } from './search-hits.ts';
import type { SearchHit } from './search-hits.ts';

describe('extractKbHits', () => {
  test('maps qmd search results, defaulting id/title/snippet from the file path', () => {
    const data = [
      { docid: '#abc', score: 0.63, file: 'qmd://ask-marcel-kb/people/jane.md', line: 2, title: 'Jane', context: 'ctx', snippet: 'the snippet' },
      { file: 'qmd://ask-marcel-kb/orgs/x.md' },
    ];

    expect(extractKbHits(data)).toEqual([
      { source: 'kb', id: '#abc', title: 'Jane', snippet: 'the snippet', uri: 'qmd://ask-marcel-kb/people/jane.md' },
      { source: 'kb', id: 'qmd://ask-marcel-kb/orgs/x.md', title: 'qmd://ask-marcel-kb/orgs/x.md', snippet: '', uri: 'qmd://ask-marcel-kb/orgs/x.md' },
    ]);
  });

  test('falls back to the context field when snippet is absent', () => {
    expect(extractKbHits([{ file: 'f', context: 'the context line' }])).toEqual([{ source: 'kb', id: 'f', title: 'f', snippet: 'the context line', uri: 'f' }]);
  });

  test('a non-array, or entries without a file, are dropped', () => {
    expect(extractKbHits({})).toEqual([]);
    expect(extractKbHits([{ docid: '#x' }, 'nope', null])).toEqual([]);
  });
});

describe('extractMailHits', () => {
  test('maps mail search results, taking webLink as the uri', () => {
    const data = { value: [{ id: 'm1', subject: 'Q3 envelope', bodyPreview: 'a preview', webLink: 'https://outlook/m1' }, { id: 'm2' }] };

    expect(extractMailHits(data)).toEqual([
      { source: 'mail', id: 'm1', title: 'Q3 envelope', snippet: 'a preview', uri: 'https://outlook/m1' },
      { source: 'mail', id: 'm2', title: '(no subject)', snippet: '', uri: '' },
    ]);
  });

  test('a non-collection, or entries without an id, are dropped', () => {
    expect(extractMailHits({})).toEqual([]);
    expect(extractMailHits({ value: [{ subject: 'no id' }, null] })).toEqual([]);
  });
});

describe('extractSharepointHits', () => {
  test('flattens hitsContainers, reading name and webUrl from each hit resource', () => {
    const data = {
      value: [
        {
          hitsContainers: [
            {
              total: 2,
              hits: [
                { hitId: 'h1', summary: 'a summary', resource: { name: 'Spec.docx', webUrl: 'https://sp/spec' } },
                { hitId: 'h2', resource: { title: 'Deck' } },
              ],
            },
          ],
        },
      ],
    };

    expect(extractSharepointHits(data)).toEqual([
      { source: 'sharepoint', id: 'h1', title: 'Spec.docx', snippet: 'a summary', uri: 'https://sp/spec?web=1' },
      { source: 'sharepoint', id: 'h2', title: 'Deck', snippet: '', uri: '' },
    ]);
  });

  test('a hit without a hitId, and structurally malformed responses, are skipped', () => {
    expect(extractSharepointHits({ value: [{ hitsContainers: [{ hits: [{ summary: 'no id' }] }] }] })).toEqual([]);
    expect(extractSharepointHits({})).toEqual([]);
    expect(extractSharepointHits({ value: [{}] })).toEqual([]);
  });
});

describe('dedupeHits', () => {
  test('drops a later hit sharing a uri with an earlier one, keeping the first', () => {
    const hits: ReadonlyArray<SearchHit> = [
      { source: 'kb', id: 'a', title: 'A', snippet: '', uri: 'u1' },
      { source: 'mail', id: 'b', title: 'B', snippet: '', uri: 'u1' },
      { source: 'sharepoint', id: 'c', title: 'C', snippet: '', uri: 'u2' },
    ];

    expect(dedupeHits(hits).map((hit) => hit.id)).toEqual(['a', 'c']);
  });

  test('uri-less hits dedupe by source and id, never collapsing distinct ids', () => {
    const hits: ReadonlyArray<SearchHit> = [
      { source: 'mail', id: 'm1', title: '', snippet: '', uri: '' },
      { source: 'mail', id: 'm1', title: '', snippet: '', uri: '' },
      { source: 'mail', id: 'm2', title: '', snippet: '', uri: '' },
    ];

    expect(dedupeHits(hits).map((hit) => hit.id)).toEqual(['m1', 'm2']);
  });
});

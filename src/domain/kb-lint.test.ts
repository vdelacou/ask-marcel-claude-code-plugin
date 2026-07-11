import { describe, expect, test } from 'bun:test';

import { lintKb, lintKbPage } from './kb-lint.ts';

const TODAY = '2026-07-11';

const page = (path: string, fields: ReadonlyArray<string>, body = 'body'): { path: string; content: string } => ({ path, content: `---\n${fields.join('\n')}\n---\n\n${body}` });
const CONFORMANT: ReadonlyArray<string> = ['type: person', 'title: Jane Boss', 'description: VP of Retail', 'timestamp: 2026-07-06'];
const ORG: ReadonlyArray<string> = ['type: organization', 'title: Acme', 'description: the group', 'timestamp: 2026-07-06'];

describe('lintKb', () => {
  test('a conformant, cross-linked collection has no issues', () => {
    expect(
      lintKb(
        [
          page('data/kb/people/jane-boss.md', CONFORMANT, 'works at [Acme](/orgs/maison-lumiere.md)'),
          page('data/kb/orgs/maison-lumiere.md', ORG, 'led by [Jane](../people/jane-boss.md)'),
        ],
        TODAY
      )
    ).toEqual([]);
  });

  test('index.md and log.md are reserved files and are not linted for frontmatter', () => {
    expect(
      lintKb(
        [
          { path: 'data/kb/people/index.md', content: '# People\n\nno frontmatter' },
          { path: 'data/kb/log.md', content: '# Log\n' },
        ],
        TODAY
      )
    ).toEqual([]);
  });

  test('reserved files are still exempted on Windows backslash paths (Bun.Glob yields \\)', () => {
    expect(
      lintKb(
        [
          { path: 'data\\kb\\people\\index.md', content: '# People\n\nno frontmatter' },
          { path: 'data\\kb\\log.md', content: '# Log\n' },
        ],
        TODAY
      )
    ).toEqual([]);
  });

  test('a duplicate slug is still detected across folders on Windows backslash paths', () => {
    const issues = lintKb([page('data\\kb\\people\\jane.md', CONFORMANT), page('data\\kb\\orgs\\jane.md', ORG)], TODAY);
    const dups = issues.filter((issue) => issue.kind === 'duplicate-slug');
    expect(dups.map((issue) => issue.path)).toEqual(['data\\kb\\people\\jane.md', 'data\\kb\\orgs\\jane.md']);
    expect(dups[0]?.detail).toBe("slug 'jane' is shared by 2 pages");
  });

  test('a concept page with no frontmatter block is flagged', () => {
    const issues = lintKb([{ path: 'data/kb/people/jane.md', content: '# Jane\n\nbody, no frontmatter' }], TODAY);
    expect(issues.filter((issue) => issue.kind === 'no-frontmatter')).toEqual([
      { path: 'data/kb/people/jane.md', kind: 'no-frontmatter', detail: 'page has no --- frontmatter block' },
    ]);
  });

  test('each missing required field is flagged individually', () => {
    const issues = lintKb([page('data/kb/topics/t.md', ['type: topic', 'title: T'])], TODAY);
    expect(issues.filter((issue) => issue.kind === 'missing-field')).toEqual([
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: description' },
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: timestamp' },
    ]);
  });

  test('the same slug under two folders is flagged as a duplicate on every copy', () => {
    const issues = lintKb([page('data/kb/people/jane.md', CONFORMANT), page('data/kb/orgs/jane.md', ORG)], TODAY);
    const dups = issues.filter((issue) => issue.kind === 'duplicate-slug');

    expect(dups.map((issue) => issue.path)).toEqual(['data/kb/people/jane.md', 'data/kb/orgs/jane.md']);
    expect(dups[0]?.detail).toBe("slug 'jane' is shared by 2 pages");
  });

  test('a unique slug is never flagged as duplicate', () => {
    const issues = lintKb(
      [page('data/kb/people/jane.md', CONFORMANT), page('data/kb/people/marc.md', ['type: person', 'title: Marc', 'description: CTO', 'timestamp: 2026-07-06'])],
      TODAY
    );
    expect(issues.filter((issue) => issue.kind === 'duplicate-slug')).toEqual([]);
  });

  test('a relative or bundle-absolute link to a missing page is flagged; anchors and reserved targets resolve', () => {
    const issues = lintKb(
      [
        page('data/kb/people/jane.md', CONFORMANT, 'see [ghost](../orgs/ghost.md) and [acme](/orgs/acme.md#people) and [the index](index.md)'),
        page('data/kb/orgs/acme.md', ORG, 'led by [Jane](../people/jane.md)'),
        { path: 'data/kb/people/index.md', content: '# People' },
      ],
      TODAY
    );

    const broken = issues.filter((issue) => issue.kind === 'broken-link');
    expect(broken).toEqual([{ path: 'data/kb/people/jane.md', kind: 'broken-link', detail: 'link target does not exist: ../orgs/ghost.md' }]);
    // the anchor link still counts as a relationship: acme is linked, so no orphan besides none at all
    expect(issues.filter((issue) => issue.kind === 'orphan')).toEqual([]);
  });

  test('external links (https, qmd, mailto) and non-md targets are never link-checked', () => {
    const issues = lintKb(
      [
        page(
          'data/kb/topics/t.md',
          ['type: topic', 'title: T', 'description: d', 'timestamp: 2026-07-06'],
          '[web](https://x.com/a.md) [kb](qmd://c/x.md) [mail](mailto:a@b.co) [mailmd](mailto:x.md) [img](../images/x.png)'
        ),
      ],
      TODAY
    );
    expect(issues.filter((issue) => issue.kind === 'broken-link')).toEqual([]);
  });

  test('./-relative links resolve within the folder', () => {
    const issues = lintKb(
      [
        page('data/kb/topics/a.md', ['type: topic', 'title: A', 'description: d', 'timestamp: 2026-07-06'], 'see [b](./b.md)'),
        page('data/kb/topics/b.md', ['type: topic', 'title: B', 'description: d', 'timestamp: 2026-07-06'], 'see [a](./a.md)'),
      ],
      TODAY
    );
    expect(issues.filter((issue) => issue.kind === 'broken-link')).toEqual([]);
  });

  test('pages at the listing root resolve relative links against an empty base', () => {
    const issues = lintKb([page('jane.md', CONFORMANT, 'works at [Acme](acme.md)'), page('acme.md', ORG, 'led by [Jane](jane.md)')], TODAY);
    expect(issues.filter((issue) => issue.kind === 'broken-link')).toEqual([]);
  });

  test('parenthesized .md mentions outside links and unclosed link syntax are not link targets', () => {
    const issues = lintKb(
      [
        page('data/kb/people/jane.md', CONFORMANT, 'she wrote (roadmap.md) once - see [Acme](/orgs/acme.md) and the dangling [draft](specs/plan.mdx'),
        page('data/kb/orgs/acme.md', ORG, 'led by [Jane](/people/jane.md)'),
      ],
      TODAY
    );
    expect(issues.filter((issue) => issue.kind === 'broken-link')).toEqual([]);
  });

  test('broken links are detected across Windows backslash listings too', () => {
    const issues = lintKb(
      [page('data\\kb\\people\\jane.md', CONFORMANT, 'works at [Acme](/orgs/acme.md)'), page('data\\kb\\orgs\\acme.md', ORG, 'led by [Jane](../people/jane.md)')],
      TODAY
    );
    expect(issues.filter((issue) => issue.kind === 'broken-link')).toEqual([]);
  });

  test('a page older than 180 days by its timestamp is stale; exactly 180 days is not', () => {
    // 2026-07-11 minus 180 days = 2026-01-12; one day older crosses the threshold
    const issues = lintKb(
      [
        page('data/kb/topics/old.md', ['type: topic', 'title: Old', 'description: d', 'timestamp: 2026-01-11'], 'links [fresh](fresh.md)'),
        page('data/kb/topics/fresh.md', ['type: topic', 'title: Fresh', 'description: d', 'timestamp: 2026-01-12'], 'links [old](old.md)'),
      ],
      TODAY
    );

    expect(issues.filter((issue) => issue.kind === 'stale')).toEqual([{ path: 'data/kb/topics/old.md', kind: 'stale', detail: 'timestamp 2026-01-11 is 181 days old (> 180)' }]);
  });

  test('an unparseable timestamp is not reported stale (missing-field owns absence)', () => {
    const issues = lintKb([page('data/kb/topics/t.md', ['type: topic', 'title: T', 'description: d', 'timestamp: not-a-date'])], TODAY);
    expect(issues.filter((issue) => issue.kind === 'stale')).toEqual([]);
  });

  test('a fractional age reports whole days (floored)', () => {
    // 2026-01-10T12:00Z to 2026-07-11T00:00Z = 181.5 days -> reported as 181
    const issues = lintKb([page('data/kb/topics/t.md', ['type: topic', 'title: T', 'description: d', 'timestamp: 2026-01-10T12:00:00Z'])], TODAY);
    expect(issues.filter((issue) => issue.kind === 'stale')).toEqual([
      { path: 'data/kb/topics/t.md', kind: 'stale', detail: 'timestamp 2026-01-10T12:00:00Z is 181 days old (> 180)' },
    ]);
  });

  test('lintKbPage checks one page corpus-independently and exempts reserved files', () => {
    expect(lintKbPage(page('data/kb/topics/t.md', ['type: topic', 'title: T']))).toEqual([
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: description' },
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: timestamp' },
    ]);
    // a fully conformant page is clean even though nothing links to it (no orphan check here)
    expect(lintKbPage(page('data/kb/people/jane.md', CONFORMANT))).toEqual([]);
    expect(lintKbPage({ path: 'data/kb/people/index.md', content: '# People - no frontmatter' })).toEqual([]);
  });

  test('a concept page nothing links to is an orphan; linked pages and jargon pages are not', () => {
    const issues = lintKb(
      [
        page('data/kb/people/jane.md', CONFORMANT, 'works at [Acme](/orgs/acme.md)'),
        page('data/kb/orgs/acme.md', ORG, 'led by [Jane](/people/jane.md)'),
        page('data/kb/topics/alone.md', ['type: topic', 'title: Alone', 'description: d', 'timestamp: 2026-07-06']),
        page('data/kb/jargon/abbreviations.md', ['type: jargon', 'title: Abbreviations', 'description: d', 'timestamp: 2026-07-06']),
      ],
      TODAY
    );

    expect(issues.filter((issue) => issue.kind === 'orphan')).toEqual([{ path: 'data/kb/topics/alone.md', kind: 'orphan', detail: 'no other concept page links to this page' }]);
  });
});

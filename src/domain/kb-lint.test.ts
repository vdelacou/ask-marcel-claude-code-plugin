import { describe, expect, test } from 'bun:test';

import { lintKb } from './kb-lint.ts';

const page = (path: string, fields: ReadonlyArray<string>): { path: string; content: string } => ({ path, content: `---\n${fields.join('\n')}\n---\n\nbody` });
const CONFORMANT: ReadonlyArray<string> = ['type: person', 'title: Jane Boss', 'description: VP of Retail', 'timestamp: 2026-07-06'];

describe('lintKb', () => {
  test('a conformant collection has no issues', () => {
    expect(
      lintKb([
        page('data/kb/people/jane-boss.md', CONFORMANT),
        page('data/kb/orgs/maison-lumiere.md', ['type: organization', 'title: Acme', 'description: the group', 'timestamp: 2026-07-06']),
      ])
    ).toEqual([]);
  });

  test('index.md and log.md are reserved files and are not linted for frontmatter', () => {
    expect(
      lintKb([
        { path: 'data/kb/people/index.md', content: '# People\n\nno frontmatter' },
        { path: 'data/kb/log.md', content: '# Log\n' },
      ])
    ).toEqual([]);
  });

  test('reserved files are still exempted on Windows backslash paths (Bun.Glob yields \\)', () => {
    expect(
      lintKb([
        { path: 'data\\kb\\people\\index.md', content: '# People\n\nno frontmatter' },
        { path: 'data\\kb\\log.md', content: '# Log\n' },
      ])
    ).toEqual([]);
  });

  test('a duplicate slug is still detected across folders on Windows backslash paths', () => {
    const issues = lintKb([
      page('data\\kb\\people\\jane.md', CONFORMANT),
      page('data\\kb\\orgs\\jane.md', ['type: organization', 'title: Jane Inc', 'description: a company', 'timestamp: 2026-07-06']),
    ]);
    const dups = issues.filter((issue) => issue.kind === 'duplicate-slug');
    expect(dups.map((issue) => issue.path)).toEqual(['data\\kb\\people\\jane.md', 'data\\kb\\orgs\\jane.md']);
    expect(dups[0]?.detail).toBe("slug 'jane' is shared by 2 pages");
  });

  test('a concept page with no frontmatter block is flagged', () => {
    expect(lintKb([{ path: 'data/kb/people/jane.md', content: '# Jane\n\nbody, no frontmatter' }])).toEqual([
      { path: 'data/kb/people/jane.md', kind: 'no-frontmatter', detail: 'page has no --- frontmatter block' },
    ]);
  });

  test('each missing required field is flagged individually', () => {
    expect(lintKb([page('data/kb/topics/t.md', ['type: topic', 'title: T'])])).toEqual([
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: description' },
      { path: 'data/kb/topics/t.md', kind: 'missing-field', detail: 'missing required field: timestamp' },
    ]);
  });

  test('the same slug under two folders is flagged as a duplicate on every copy', () => {
    const issues = lintKb([
      page('data/kb/people/jane.md', CONFORMANT),
      page('data/kb/orgs/jane.md', ['type: organization', 'title: Jane Inc', 'description: a company', 'timestamp: 2026-07-06']),
    ]);
    const dups = issues.filter((issue) => issue.kind === 'duplicate-slug');

    expect(dups.map((issue) => issue.path)).toEqual(['data/kb/people/jane.md', 'data/kb/orgs/jane.md']);
    expect(dups[0]?.detail).toBe("slug 'jane' is shared by 2 pages");
  });

  test('a unique slug is never flagged as duplicate', () => {
    const issues = lintKb([
      page('data/kb/people/jane.md', CONFORMANT),
      page('data/kb/people/marc.md', ['type: person', 'title: Marc', 'description: CTO', 'timestamp: 2026-07-06']),
    ]);
    expect(issues.filter((issue) => issue.kind === 'duplicate-slug')).toEqual([]);
  });
});

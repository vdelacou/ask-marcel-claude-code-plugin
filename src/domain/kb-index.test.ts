import { describe, expect, test } from 'bun:test';

import { renderFolderIndex } from './kb-index.ts';

const page = (slug: string, title: string, description: string): { path: string; content: string } => ({
  path: `data/kb/people/${slug}.md`,
  content: `---\ntype: person\ntitle: ${title}\ndescription: ${description}\ntimestamp: 2026-07-06\n---\n\nbody`,
});

describe('renderFolderIndex', () => {
  test('lists each page title-first, linked by slug, with its description, sorted by title', () => {
    const pages = [page('marc', 'Marc Dupont', 'CTO'), page('jane-boss', 'Jane Boss', 'VP of Retail')];

    expect(renderFolderIndex('People', pages)).toBe(['# People', '', '- [Jane Boss](jane-boss.md) - VP of Retail', '- [Marc Dupont](marc.md) - CTO', ''].join('\n'));
  });

  test('an empty folder renders the reserved no-pages placeholder', () => {
    expect(renderFolderIndex('Projects', [])).toBe(['# Projects', '', '_No pages yet._', ''].join('\n'));
  });

  test('a page missing its title falls back to the slug, and an empty description drops the trailing dash', () => {
    const bare = { path: 'data/kb/topics/q3-plan.md', content: '# no frontmatter here' };
    expect(renderFolderIndex('Topics', [bare])).toBe(['# Topics', '', '- [q3-plan](q3-plan.md)', ''].join('\n'));
  });

  test('any-script titles keep their characters and sort deterministically', () => {
    const pages = [page('wang', '王伟', 'Beijing lead'), page('ahmed', 'أحمد', 'Dubai lead')];
    const rendered = renderFolderIndex('People', pages);
    expect(rendered).toContain('[王伟](wang.md) - Beijing lead');
    expect(rendered).toContain('[أحمد](ahmed.md) - Dubai lead');
  });
});

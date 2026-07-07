import { describe, expect, test } from 'bun:test';

import { kbPagePath, mergeUpdate, renderOkfPage } from './okf-page.ts';
import type { KbPageInput } from './okf-page.ts';

const INPUT: KbPageInput = {
  folder: 'people',
  slug: 'jane-boss',
  type: 'person',
  title: 'Jane Boss',
  description: 'VP of Retail, approves Q3 envelopes',
  resource: 'https://outlook/thread',
  tags: ['person', 'retail'],
  content: 'Focus areas: retail ops.\n\n## Commitments\n\n- 2026-07-01: approved the Q3 envelope.',
  citations: ['https://outlook/m1', 'qmd://ask-marcel-kb/orgs/maison-lumiere-com.md'],
};

describe('kbPagePath', () => {
  test('addresses a page by folder and slug under the KB root', () => {
    expect(kbPagePath('people', 'jane-boss')).toBe('data/kb/people/jane-boss.md');
  });
});

describe('renderOkfPage', () => {
  test('renders OKF frontmatter, a title heading, the body, and a numbered citations block', () => {
    expect(renderOkfPage(INPUT, '2026-07-06')).toBe(
      [
        '---',
        'type: person',
        'title: Jane Boss',
        'description: VP of Retail, approves Q3 envelopes',
        'resource: https://outlook/thread',
        'tags:',
        '  - person',
        '  - retail',
        'timestamp: 2026-07-06',
        '---',
        '',
        '# Jane Boss',
        '',
        'Focus areas: retail ops.\n\n## Commitments\n\n- 2026-07-01: approved the Q3 envelope.',
        '',
        '# Citations',
        '',
        '[1] https://outlook/m1',
        '[2] qmd://ask-marcel-kb/orgs/maison-lumiere-com.md',
        '',
      ].join('\n')
    );
  });

  test('omits the resource line when absent and the citations block when there are none', () => {
    const minimal: KbPageInput = { folder: 'topics', slug: 't', type: 'topic', title: 'T', description: 'd', tags: ['topic'], content: 'body', citations: [] };
    const rendered = renderOkfPage(minimal, '2026-07-06');
    expect(rendered).not.toContain('resource:');
    expect(rendered).not.toContain('# Citations');
    expect(rendered).toBe(['---', 'type: topic', 'title: T', 'description: d', 'tags:', '  - topic', 'timestamp: 2026-07-06', '---', '', '# T', '', 'body', ''].join('\n'));
  });
});

describe('mergeUpdate', () => {
  test('appends a dated Update section, never overwriting the existing page', () => {
    const existing = '---\ntype: person\n---\n\n# Jane Boss\n\nOriginal body.\n';
    expect(mergeUpdate(existing, 'She now also owns EMEA.', '2026-07-06')).toBe(
      '---\ntype: person\n---\n\n# Jane Boss\n\nOriginal body.\n\n## Update 2026-07-06\n\nShe now also owns EMEA.\n'
    );
  });
});

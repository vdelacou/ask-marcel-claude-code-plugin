import { describe, expect, test } from 'bun:test';

import { readFrontmatter } from './kb-frontmatter.ts';

describe('readFrontmatter', () => {
  test('reads the top-level scalar fields into a map', () => {
    const fm = readFrontmatter('---\ntype: person\ntitle: Jane Boss\ndescription: VP of Retail\ntimestamp: 2026-07-06\n---\n\n# Jane\n\nbody');
    expect(fm?.get('type')).toBe('person');
    expect(fm?.get('title')).toBe('Jane Boss');
    expect(fm?.get('description')).toBe('VP of Retail');
    expect(fm?.get('timestamp')).toBe('2026-07-06');
  });

  test('a list value (tags) keys to an empty string and its indented items are ignored', () => {
    const fm = readFrontmatter('---\ntype: person\ntags:\n  - retail\n  - vip\n---\n\nbody');
    expect(fm?.get('tags')).toBe('');
    expect([...(fm?.keys() ?? [])]).toEqual(['type', 'tags']);
  });

  test('content with no leading frontmatter block, or an unterminated one, is undefined', () => {
    expect(readFrontmatter('# Index\n\nno frontmatter here')).toBeUndefined();
    expect(readFrontmatter('---\ntype: x\nnever closed')).toBeUndefined();
  });

  test('keys and values are trimmed of surrounding whitespace', () => {
    const fm = readFrontmatter('---\ntype:   person value  \n---\n\nbody');
    expect(fm?.get('type')).toBe('person value');
  });

  test('blank lines, indented lines, and lines without a colon are skipped inside the block', () => {
    const fm = readFrontmatter('---\ntype: person\n\n  indented: skip me\nplain line without a colon\ntitle: Jane\n---\n\nbody');
    expect([...(fm?.keys() ?? [])]).toEqual(['type', 'title']);
  });

  test('the opening delimiter must be exactly "---\\n" at the very start', () => {
    // a space after the dashes is not the delimiter, and a block that does not start the content is ignored
    expect(readFrontmatter('--- \ntype: x\n---\n')).toBeUndefined();
    expect(readFrontmatter('preamble\n---\ntype: x\n---\n')).toBeUndefined();
  });

  test('a value may itself contain a colon', () => {
    expect(readFrontmatter('---\nresource: https://x/y\n---\n\nbody')?.get('resource')).toBe('https://x/y');
  });
});

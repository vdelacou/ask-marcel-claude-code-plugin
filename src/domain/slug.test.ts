import { describe, expect, test } from 'bun:test';

import { toSlug } from './slug.ts';

describe('slug', () => {
  test('accented names produce ascii slugs', () => {
    expect(toSlug('Éloïse Dûpont')).toBe('eloise-dupont');
    expect(toSlug("Jean-Pierre O'Neil")).toBe('jean-pierre-o-neil');
    expect(toSlug('  Vincent   DELACOURT  ')).toBe('vincent-delacourt');
    expect(toSlug('François-Xavier de La Tour')).toBe('francois-xavier-de-la-tour');
    expect(toSlug('adama-development.com')).toBe('adama-development-com');
  });

  test('CJK names slug to their characters, never to an empty path', () => {
    expect(toSlug('王伟')).toBe('王伟');
    expect(toSlug('田中 太郎')).toBe('田中-太郎');
    expect(toSlug('김철수 (Kim)')).toBe('김철수-kim');
    expect(toSlug('Иван Петров')).toBe('иван-петров');
    expect(toSlug('!!!')).toMatch(/^x-[0-9a-f]{8}$/);
    expect(toSlug('!!!')).toBe(toSlug('!!!'));
    expect(toSlug('!!!')).not.toBe(toSlug('???'));
  });
});

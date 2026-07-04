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
});

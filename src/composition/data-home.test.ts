import { describe, expect, test } from 'bun:test';

import { resolveDataHome } from './data-home.ts';

describe('data-home', () => {
  test('defaults to the plugin root when ASK_MARCEL_HOME is unset', () => {
    expect(resolveDataHome({}, '/plugins/email-replu')).toBe('/plugins/email-replu');
  });

  test('an explicit ASK_MARCEL_HOME overrides the plugin root', () => {
    expect(resolveDataHome({ ASK_MARCEL_HOME: '/Users/v/inbox' }, '/plugins/email-replu')).toBe('/Users/v/inbox');
  });

  test('an empty ASK_MARCEL_HOME falls back to the plugin root', () => {
    expect(resolveDataHome({ ASK_MARCEL_HOME: '' }, '/plugins/email-replu')).toBe('/plugins/email-replu');
  });
});

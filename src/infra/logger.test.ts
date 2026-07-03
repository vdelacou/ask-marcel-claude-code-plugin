import { describe, expect, test } from 'bun:test';

import { createWinstonLogger } from './logger.ts';

describe('winston logger adapter', () => {
  test('the adapter satisfies the Logger port and logs a token-bearing meta without throwing', () => {
    const logger = createWinstonLogger('error');

    logger.info('auth-refreshed', { token: 'secret-value' });
    logger.warn('quota-low', { remaining: 3 });
    logger.error('boom', { token: 'secret-value' });

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

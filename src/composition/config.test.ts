import { describe, expect, test } from 'bun:test';

import { loadConfig } from './config.ts';

const V01_DEFAULTS = {
  seed: { relevantTop: 15, pageCap: 40 },
  voice: { fetchTop: 100, keep: 50 },
  scan: { cap: 25 },
  triage: { batchSize: 4 },
  research: { batchSize: 2 },
  search: { topPerBackend: 10 },
  scratch: { retentionDays: 7 },
  followUps: { fetchTop: 100, minAgeDays: 3 },
};

describe('config', () => {
  test('config carries the v0.1 caps and batches (decision 15), defaults the log level to info, and honors LOG_LEVEL', () => {
    expect(loadConfig({})).toEqual({ logLevel: 'info', ...V01_DEFAULTS });
    expect(loadConfig({ LOG_LEVEL: 'debug' })).toEqual({ logLevel: 'debug', ...V01_DEFAULTS });
  });
});

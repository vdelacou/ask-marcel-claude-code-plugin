import { describe, expect, test } from 'bun:test';

import { expiredRunDirs, SCRATCH_RETENTION_DAYS } from './scratch-retention.ts';

const TODAY = '2026-07-11';

describe('scratch-retention', () => {
  test('a run dir strictly older than the retention window expires; one exactly at the boundary survives', () => {
    // 2026-07-11 minus 7 days = 2026-07-04: that run is exactly 7 days old and stays
    const expired = expiredRunDirs(
      ['data/scratch/run-20260703-235959/state.json', 'data/scratch/run-20260704-000001/state.json', 'data/scratch/run-20260711-060000/state.json'],
      TODAY,
      SCRATCH_RETENTION_DAYS
    );

    expect(expired).toEqual(['data/scratch/run-20260703-235959']);
    expect(expired).toHaveLength(1);
  });

  test('windows backslash listings resolve to their run dir too', () => {
    expect(expiredRunDirs(['data\\scratch\\run-20260601-120000\\state.json'], TODAY, 7)).toEqual(['data\\scratch\\run-20260601-120000']);
  });

  test('dirs whose name cannot be dated are never swept', () => {
    expect(expiredRunDirs(['data/scratch/not-a-run/state.json', 'data/scratch/run-abc/state.json', 'state.json'], TODAY, 7)).toEqual([]);
  });

  test('a bare relative run dir (no scratch prefix) still resolves and sweeps', () => {
    expect(expiredRunDirs(['run-20260601-070000/state.json'], TODAY, 7)).toEqual(['run-20260601-070000']);
  });

  test('a dir whose name is not run-prefixed is never swept, even when chars 4-12 parse as an old date', () => {
    // slice(4, 12) of 'save20200101-old' is exactly '20200101' - only the run- prefix protects this dir
    expect(expiredRunDirs(['data/scratch/save20200101-old/state.json'], TODAY, 7)).toEqual([]);
  });

  test('a bare datable path with no separator is not treated as a run dir', () => {
    expect(expiredRunDirs(['run-20200101-000000'], TODAY, 7)).toEqual([]);
  });

  test('a date-only run dir name (exactly run-YYYYMMDD) is still dateable and sweeps when old', () => {
    expect(expiredRunDirs(['data/scratch/run-20260101/state.json'], TODAY, 7)).toEqual(['data/scratch/run-20260101']);
  });

  test('an unparseable today sweeps nothing (fail safe, not fail destructive)', () => {
    expect(expiredRunDirs(['data/scratch/run-20200101-000000/state.json'], 'garbage-date', 7)).toEqual([]);
  });
});

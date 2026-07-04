import { describe, expect, test } from 'bun:test';

import type { DoctorReport } from '../domain/doctor.ts';
import { renderDoctorJson, renderDoctorText } from './doctor-report.ts';

const REPORT: DoctorReport = {
  ready: false,
  checks: [
    { id: 'bun', status: 'ok', detail: '1.3.14' },
    { id: 'auth', status: 'missing', detail: 'no valid Microsoft 365 session', fix: 'ask-marcel login' },
  ],
};

describe('doctor report presenter', () => {
  test('a ready report renders one ✓ line per check', () => {
    const text = renderDoctorText({ ready: true, checks: [{ id: 'bun', status: 'ok', detail: '1.3.14' }] });

    expect(text).toBe('doctor: READY\n✓ bun: ok - 1.3.14');
  });

  test('a failing check renders its fix on the following line', () => {
    const text = renderDoctorText(REPORT);

    expect(text).toBe('doctor: NOT READY\n✓ bun: ok - 1.3.14\n✗ auth: missing - no valid Microsoft 365 session\n    fix: ask-marcel login');
  });

  test('the JSON envelope round-trips the report', () => {
    expect(JSON.parse(renderDoctorJson(REPORT))).toEqual({ ok: true, ready: false, checks: REPORT.checks });
  });
});

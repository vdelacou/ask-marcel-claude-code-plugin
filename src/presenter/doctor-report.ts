import type { DoctorCheck, DoctorReport } from '../domain/doctor.ts';

const line = (check: DoctorCheck): string => {
  const mark = check.status === 'ok' ? '✓' : '✗';
  const head = `${mark} ${check.id}: ${check.status} - ${check.detail}`;
  return check.fix === undefined ? head : `${head}\n    fix: ${check.fix}`;
};

export const renderDoctorText = (report: DoctorReport): string => {
  const headline = report.ready ? 'doctor: READY' : 'doctor: NOT READY';
  return [headline, ...report.checks.map(line)].join('\n');
};

export const renderDoctorJson = (report: DoctorReport): string => JSON.stringify({ ok: true, ready: report.ready, checks: report.checks });

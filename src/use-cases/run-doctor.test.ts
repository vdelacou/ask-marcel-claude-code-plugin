import { describe, expect, test } from 'bun:test';

import type { DoctorCheck, DoctorReport } from '../domain/doctor.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { CommandOutput, CommandRunner, RunError } from './ports/command-runner.ts';
import type { FileProbe } from './ports/file-probe.ts';
import { createRunDoctor } from './run-doctor.ts';

type Responses = Readonly<Record<string, Result<CommandOutput, RunError>>>;

type RunnerFake = CommandRunner & { readonly log: ReadonlyArray<string> };

const createRunnerFake = (responses: Responses): RunnerFake => {
  const log: string[] = [];
  return {
    log,
    run: async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      log.push(key);
      return responses[key] ?? err({ kind: 'not-found', message: `${cmd}: command not found` });
    },
  };
};

const createFileProbeFake = (present: ReadonlyArray<string>): FileProbe => ({
  exists: async (path) => present.includes(path),
});

const ALL_TOOLS: Responses = {
  'bun --version': ok({ stdout: '1.3.14', exitCode: 0 }),
  'qmd --version': ok({ stdout: '2.6.0', exitCode: 0 }),
  'ask-marcel-office --version': ok({ stdout: '2.0.0', exitCode: 0 }),
  'ask-marcel-office get-current-user': ok({ stdout: 'displayName: user', exitCode: 0 }),
  'qmd collection list': ok({ stdout: 'replu-kb (qmd://replu-kb/)', exitCode: 0 }),
};

const ALL_FILES = ['data/kb/index.md', 'data/profile/voice-profile.md', 'data/profile/user.md'];

const runDoctor = async (overrides: Responses = {}, files: ReadonlyArray<string> = ALL_FILES): Promise<{ report: DoctorReport; runner: RunnerFake }> => {
  const runner = createRunnerFake({ ...ALL_TOOLS, ...overrides });
  const doctor = createRunDoctor({ runner, files: createFileProbeFake(files), logger: createLoggerFake() });
  const result = await doctor();
  if (!result.ok) throw new Error('doctor never errs');
  return { report: result.value, runner };
};

const check = (report: DoctorReport, id: string): DoctorCheck => {
  const found = report.checks.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no check ${id}`);
  return found;
};

describe('run-doctor', () => {
  test('a machine with every tool installed, authenticated, and a built KB is reported ready', async () => {
    const { report } = await runDoctor();

    expect(report.ready).toBe(true);
    expect(report.checks).toEqual([
      { id: 'bun', status: 'ok', detail: '1.3.14' },
      { id: 'qmd', status: 'ok', detail: '2.6.0' },
      { id: 'ask-marcel-office', status: 'ok', detail: '2.0.0' },
      { id: 'auth', status: 'ok', detail: 'Microsoft 365 session valid' },
      { id: 'kb', status: 'ok', detail: 'data/kb/index.md' },
      { id: 'qmd-collection', status: 'ok', detail: 'replu-kb registered' },
      { id: 'voice-profile', status: 'ok', detail: 'data/profile/voice-profile.md' },
      { id: 'user-md', status: 'ok', detail: 'data/profile/user.md' },
    ]);
  });

  test('a missing bun installation is reported with its install fix, not a crash', async () => {
    const { report } = await runDoctor({ 'bun --version': err({ kind: 'not-found', message: 'bun: command not found' }) });

    expect(report.ready).toBe(false);
    expect(check(report, 'bun')).toEqual({
      id: 'bun',
      status: 'missing',
      detail: 'not installed',
      fix: 'curl -fsSL https://bun.sh/install | bash - then add ~/.bun/bin to PATH in ~/.zshrc',
    });
  });

  test('an outdated qmd is flagged with the minimum version named', async () => {
    const { report } = await runDoctor({ 'qmd --version': ok({ stdout: '2.4.0', exitCode: 0 }) });

    expect(check(report, 'qmd')).toEqual({
      id: 'qmd',
      status: 'outdated',
      detail: '2.4.0 is below the minimum 2.5.0',
      fix: 'bun install -g @tobilu/qmd',
    });
  });

  test('an unauthenticated ask-marcel is a login fix, and no login is ever attempted', async () => {
    const { report, runner } = await runDoctor({ 'ask-marcel-office get-current-user': ok({ stdout: 'InteractionRequired', exitCode: 1 }) });

    expect(check(report, 'auth')).toEqual({ id: 'auth', status: 'missing', detail: 'no valid Microsoft 365 session', fix: 'ask-marcel-office login' });
    expect(runner.log.some((c) => c.includes('login'))).toBe(false);
  });

  test('a repo without KB or profiles lists each initialization step separately', async () => {
    const { report } = await runDoctor({}, []);

    expect(report.ready).toBe(false);
    expect(check(report, 'kb')).toEqual({ id: 'kb', status: 'missing', detail: 'data/kb/index.md is missing', fix: 'initialize the OKF tree under data/kb (setup skill)' });
    expect(check(report, 'voice-profile')).toEqual({
      id: 'voice-profile',
      status: 'missing',
      detail: 'data/profile/voice-profile.md is missing',
      fix: 'run the voice-profile skill',
    });
    expect(check(report, 'user-md')).toEqual({ id: 'user-md', status: 'missing', detail: 'data/profile/user.md is missing', fix: 'seed data/profile/user.md (setup skill)' });
  });

  test('the qmd collection must be the replu one, not just any collection', async () => {
    const { report } = await runDoctor({ 'qmd collection list': ok({ stdout: 'marcel-knowledge-base (qmd://marcel-knowledge-base/)', exitCode: 0 }) });

    expect(check(report, 'qmd-collection')).toEqual({
      id: 'qmd-collection',
      status: 'missing',
      detail: 'collection replu-kb is not registered',
      fix: 'qmd collection add data/kb --name replu-kb',
    });
  });

  test('a tool at exactly the minimum version passes the gate', async () => {
    const { report } = await runDoctor({ 'bun --version': ok({ stdout: '1.2.0', exitCode: 0 }) });

    expect(check(report, 'bun').status).toBe('ok');
  });

  test('version strings wrapped in tool banners still parse', async () => {
    const { report } = await runDoctor({ 'qmd --version': ok({ stdout: 'qmd version 2.6.1 (arm64)', exitCode: 0 }) });

    expect(check(report, 'qmd').status).toBe('ok');
  });

  test('a command runner explosion becomes an error check, never a thrown crash', async () => {
    const { report } = await runDoctor({ 'qmd --version': err({ kind: 'spawn-failed', message: 'EPERM boom' }) });

    expect(check(report, 'qmd')).toEqual({ id: 'qmd', status: 'error', detail: 'EPERM boom' });
    expect(report.ready).toBe(false);
  });

  test('a machine with no CLIs at all reports every tool missing and still no crash', async () => {
    const notFound = (name: string): Result<CommandOutput, RunError> => err({ kind: 'not-found', message: `${name}: command not found` });
    const { report } = await runDoctor({
      'bun --version': notFound('bun'),
      'qmd --version': notFound('qmd'),
      'ask-marcel-office --version': notFound('ask-marcel-office'),
      'ask-marcel-office get-current-user': notFound('ask-marcel-office'),
      'qmd collection list': notFound('qmd'),
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toEqual([
      { id: 'bun', status: 'missing', detail: 'not installed', fix: 'curl -fsSL https://bun.sh/install | bash - then add ~/.bun/bin to PATH in ~/.zshrc' },
      { id: 'qmd', status: 'missing', detail: 'not installed', fix: 'bun install -g @tobilu/qmd' },
      { id: 'ask-marcel-office', status: 'missing', detail: 'not installed', fix: 'npm i -g ask-marcel-office-cli (or: ask-marcel-office update)' },
      { id: 'auth', status: 'missing', detail: 'no valid Microsoft 365 session', fix: 'ask-marcel-office login' },
      { id: 'kb', status: 'ok', detail: 'data/kb/index.md' },
      { id: 'qmd-collection', status: 'missing', detail: 'qmd is not installed', fix: 'qmd collection add data/kb --name replu-kb' },
      { id: 'voice-profile', status: 'ok', detail: 'data/profile/voice-profile.md' },
      { id: 'user-md', status: 'ok', detail: 'data/profile/user.md' },
    ]);
  });

  test('a tool that exits non-zero on --version is an error check', async () => {
    const { report } = await runDoctor({ 'qmd --version': ok({ stdout: 'segfault', exitCode: 3 }) });

    expect(check(report, 'qmd')).toEqual({ id: 'qmd', status: 'error', detail: 'exited 3' });
  });

  test('a tool whose version output has no semver is an error, not a guess', async () => {
    const { report } = await runDoctor({ 'qmd --version': ok({ stdout: 'built from source', exitCode: 0 }) });

    expect(check(report, 'qmd')).toEqual({ id: 'qmd', status: 'error', detail: 'unparseable version output: built from source' });
  });

  test('an auth probe explosion is an error check, not a false login prompt', async () => {
    const { report } = await runDoctor({ 'ask-marcel-office get-current-user': err({ kind: 'spawn-failed', message: 'token cache corrupt' }) });

    expect(check(report, 'auth')).toEqual({ id: 'auth', status: 'error', detail: 'token cache corrupt' });
  });

  test('a qmd that cannot list collections is an error check', async () => {
    const { report } = await runDoctor({ 'qmd collection list': err({ kind: 'spawn-failed', message: 'timeout after 10s' }) });

    expect(check(report, 'qmd-collection')).toEqual({ id: 'qmd-collection', status: 'error', detail: 'timeout after 10s' });
  });
});

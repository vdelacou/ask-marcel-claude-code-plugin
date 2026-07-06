import { evaluateDoctor } from '../domain/doctor.ts';
import type { AuthProbe, DoctorReport, ToolProbe } from '../domain/doctor.ts';
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { CommandOutput, CommandRunner, RunError } from './ports/command-runner.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { Logger } from './ports/logger.ts';
import type { Office, OfficeError } from './ports/office.ts';

export type RunDoctor = () => Promise<Result<DoctorReport, never>>;

type Deps = {
  readonly office: Office;
  readonly runner: CommandRunner;
  readonly files: FileProbe;
  readonly logger: Logger;
};

const toToolProbe = (result: Result<CommandOutput, RunError>): ToolProbe => {
  if (!result.ok) return result.error.kind === 'not-found' ? { kind: 'absent' } : { kind: 'failed', message: result.error.message };
  if (result.value.exitCode !== 0) return { kind: 'failed', message: `exited ${result.value.exitCode}` };
  return { kind: 'version', stdout: result.value.stdout };
};

// A live get-current-user through the library is the M365 readiness probe: any failure (no
// session, expired token, unreachable) means the user should sign in again.
const toAuthProbe = (result: Result<unknown, OfficeError>): AuthProbe => (result.ok ? { kind: 'ok' } : { kind: 'unauthenticated' });

const gatherProbes = (
  deps: Deps
): Promise<[Result<CommandOutput, RunError>, Result<CommandOutput, RunError>, Result<unknown, OfficeError>, Result<CommandOutput, RunError>, boolean, boolean, boolean]> =>
  Promise.all([
    deps.runner.run('bun', ['--version']),
    deps.runner.run('qmd', ['--version']),
    deps.office.execute('get-current-user', {}),
    deps.runner.run('qmd', ['collection', 'list']),
    deps.files.exists('data/kb/index.md'),
    deps.files.exists('data/profile/voice-profile.md'),
    deps.files.exists('data/profile/user.md'),
  ]);

export const createRunDoctor =
  (deps: Deps): RunDoctor =>
  async () => {
    const [bun, qmd, auth, collections, kbExists, voiceProfileExists, userMdExists] = await gatherProbes(deps);
    const report = evaluateDoctor({
      bun: toToolProbe(bun),
      qmd: toToolProbe(qmd),
      auth: toAuthProbe(auth),
      collections: toToolProbe(collections),
      kbExists,
      voiceProfileExists,
      userMdExists,
    });
    deps.logger.info('doctor-completed', { ready: report.ready });
    return ok(report);
  };

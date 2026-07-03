import { evaluateDoctor } from '../domain/doctor.ts';
import type { AuthProbe, DoctorReport, ToolProbe } from '../domain/doctor.ts';
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { CommandOutput, CommandRunner, RunError } from './ports/command-runner.ts';
import type { Logger } from './ports/logger.ts';

export type RunDoctor = () => Promise<Result<DoctorReport, never>>;

type Deps = {
  readonly runner: CommandRunner;
  readonly logger: Logger;
};

const toToolProbe = (result: Result<CommandOutput, RunError>): ToolProbe => {
  if (!result.ok) return result.error.kind === 'not-found' ? { kind: 'absent' } : { kind: 'failed', message: result.error.message };
  if (result.value.exitCode !== 0) return { kind: 'failed', message: `exited ${result.value.exitCode}` };
  return { kind: 'version', stdout: result.value.stdout };
};

const toAuthProbe = (result: Result<CommandOutput, RunError>): AuthProbe => {
  if (!result.ok) return result.error.kind === 'not-found' ? { kind: 'unauthenticated' } : { kind: 'failed', message: result.error.message };
  return result.value.exitCode === 0 ? { kind: 'ok' } : { kind: 'unauthenticated' };
};

const gatherProbes = (deps: Deps): Promise<[Result<CommandOutput, RunError>, Result<CommandOutput, RunError>, Result<CommandOutput, RunError>, Result<CommandOutput, RunError>]> =>
  Promise.all([
    deps.runner.run('bun', ['--version']),
    deps.runner.run('qmd', ['--version']),
    deps.runner.run('ask-marcel', ['--version']),
    deps.runner.run('ask-marcel', ['get-current-user']),
  ]);

export const createRunDoctor =
  (deps: Deps): RunDoctor =>
  async () => {
    const [bun, qmd, askMarcel, auth] = await gatherProbes(deps);
    const report = evaluateDoctor({
      bun: toToolProbe(bun),
      qmd: toToolProbe(qmd),
      askMarcel: toToolProbe(askMarcel),
      auth: toAuthProbe(auth),
    });
    deps.logger.info('doctor-completed', { ready: report.ready });
    return ok(report);
  };

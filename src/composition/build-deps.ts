import { createBunCommandRunner } from '../infra/command-runner.ts';
import { createBunFileProbe } from '../infra/file-probe.ts';
import { createWinstonLogger } from '../infra/logger.ts';
import type { CommandRunner } from '../use-cases/ports/command-runner.ts';
import type { FileProbe } from '../use-cases/ports/file-probe.ts';
import type { Logger } from '../use-cases/ports/logger.ts';
import type { AppConfig } from './config.ts';

export type Deps = {
  readonly runner: CommandRunner;
  readonly files: FileProbe;
  readonly logger: Logger;
};

export const buildDeps = (config: AppConfig): Deps => ({
  runner: createBunCommandRunner(),
  files: createBunFileProbe(),
  logger: createWinstonLogger(config.logLevel),
});

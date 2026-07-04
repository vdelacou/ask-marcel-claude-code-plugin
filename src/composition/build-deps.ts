import { createSystemClock } from '../infra/clock.ts';
import { createBunCommandRunner } from '../infra/command-runner.ts';
import { createBunFileProbe } from '../infra/file-probe.ts';
import { createBunFileWriter } from '../infra/file-writer.ts';
import { createWinstonLogger } from '../infra/logger.ts';
import type { Clock } from '../use-cases/ports/clock.ts';
import type { CommandRunner } from '../use-cases/ports/command-runner.ts';
import type { FileProbe } from '../use-cases/ports/file-probe.ts';
import type { FileWriter } from '../use-cases/ports/file-writer.ts';
import type { Logger } from '../use-cases/ports/logger.ts';
import type { AppConfig } from './config.ts';

export type Deps = {
  readonly runner: CommandRunner;
  readonly files: FileProbe;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

export const buildDeps = (config: AppConfig): Deps => ({
  runner: createBunCommandRunner(),
  files: createBunFileProbe(),
  writer: createBunFileWriter(),
  clock: createSystemClock(),
  logger: createWinstonLogger(config.logLevel),
});

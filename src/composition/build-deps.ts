import { createBunBinaryWriter } from '../infra/binary-writer.ts';
import { createSystemClock } from '../infra/clock.ts';
import { createBunCommandRunner } from '../infra/command-runner.ts';
import { createBunFileLister } from '../infra/file-lister.ts';
import { createBunFileProbe } from '../infra/file-probe.ts';
import { createBunFileReader } from '../infra/file-reader.ts';
import { createFileStateStore } from '../infra/file-state-store.ts';
import { createBunFileWriter } from '../infra/file-writer.ts';
import { createWinstonLogger } from '../infra/logger.ts';
import { createOffice } from '../infra/office.ts';
import type { BinaryWriter } from '../use-cases/ports/binary-writer.ts';
import type { Clock } from '../use-cases/ports/clock.ts';
import type { CommandRunner } from '../use-cases/ports/command-runner.ts';
import type { FileLister } from '../use-cases/ports/file-lister.ts';
import type { FileProbe } from '../use-cases/ports/file-probe.ts';
import type { FileReader } from '../use-cases/ports/file-reader.ts';
import type { FileWriter } from '../use-cases/ports/file-writer.ts';
import type { Logger } from '../use-cases/ports/logger.ts';
import type { Office } from '../use-cases/ports/office.ts';
import type { StateStore } from '../use-cases/ports/state-store.ts';
import type { AppConfig } from './config.ts';

export type Deps = {
  readonly office: Office;
  readonly runner: CommandRunner;
  readonly files: FileProbe;
  readonly reader: FileReader;
  readonly writer: FileWriter;
  readonly binaryWriter: BinaryWriter;
  readonly lister: FileLister;
  readonly stateStore: StateStore;
  readonly clock: Clock;
  readonly logger: Logger;
};

// `runner` survives for the non-M365 tools only (qmd, bun); all Microsoft 365 access is `office` (SPEC §15.1 R1).
export const buildDeps = (config: AppConfig): Deps => ({
  office: createOffice(),
  runner: createBunCommandRunner(),
  files: createBunFileProbe(),
  reader: createBunFileReader(),
  writer: createBunFileWriter(),
  binaryWriter: createBunBinaryWriter(),
  lister: createBunFileLister(),
  stateStore: createFileStateStore('data'),
  clock: createSystemClock(),
  logger: createWinstonLogger(config.logLevel),
});

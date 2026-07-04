import { KB_ROOT, kbSkeleton } from '../domain/okf-kb.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type InitKbSummary = { readonly created: ReadonlyArray<string> };

export type InitKb = () => Promise<Result<InitKbSummary, WriteError>>;

type Deps = {
  readonly files: FileProbe;
  readonly writer: FileWriter;
  readonly clock: Clock;
  readonly logger: Logger;
};

export const createInitKb =
  (deps: Deps): InitKb =>
  async () => {
    if (await deps.files.exists(`${KB_ROOT}/index.md`)) {
      deps.logger.info('kb-init-skipped', { reason: 'already initialized' });
      return ok({ created: [] });
    }
    const created: string[] = [];
    for (const file of kbSkeleton(deps.clock.todayIso())) {
      const written = await deps.writer.write(file.path, file.content);
      if (!written.ok) return err(written.error);
      created.push(file.path);
    }
    deps.logger.info('kb-initialized', { files: created.length });
    return ok({ created });
  };

import { appendLogEntries } from '../domain/kb-log.ts';
import { kbPagePath, mergeUpdate, renderOkfPage } from '../domain/okf-page.ts';
import type { KbPageInput } from '../domain/okf-page.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type WriteKbPageOutcome = { readonly outcome: 'wrote' | 'merged'; readonly path: string };

export type WriteKbPageError = ReadError | WriteError;

export type WriteKbPage = (input: KbPageInput) => Promise<Result<WriteKbPageOutcome, WriteKbPageError>>;

type Deps = { readonly files: FileProbe; readonly reader: FileReader; readonly writer: FileWriter; readonly clock: Clock; readonly logger: Logger };

const LOG_PATH = 'data/kb/log.md';

const appendLog = async (deps: Deps, todayIso: string, entry: string): Promise<Result<void, WriteKbPageError>> => {
  const existing = await deps.reader.read(LOG_PATH);
  if (!existing.ok) return err(existing.error);
  return deps.writer.write(LOG_PATH, appendLogEntries(existing.value, todayIso, [entry]));
};

// A vetted kb-curator page: created when no home exists, otherwise merged under a dated Update (SPEC §8).
export const createWriteKbPage =
  (deps: Deps): WriteKbPage =>
  async (input) => {
    const path = kbPagePath(input.folder, input.slug);
    const todayIso = deps.clock.todayIso();
    const exists = await deps.files.exists(path);
    const page = exists ? await mergedPage(deps, path, input, todayIso) : ok(renderOkfPage(input, todayIso));
    if (!page.ok) return err(page.error);
    const written = await deps.writer.write(path, page.value);
    if (!written.ok) return err(written.error);
    const outcome: 'wrote' | 'merged' = exists ? 'merged' : 'wrote';
    const logged = await appendLog(deps, todayIso, `kb-curator: ${outcome} ${input.folder}/${input.slug}.md`);
    if (!logged.ok) return err(logged.error);
    deps.logger.info('kb-page-written', { path, outcome });
    return ok({ outcome, path });
  };

const mergedPage = async (deps: Deps, path: string, input: KbPageInput, todayIso: string): Promise<Result<string, WriteKbPageError>> => {
  const existing = await deps.reader.read(path);
  return existing.ok ? ok(mergeUpdate(existing.value, input.content, todayIso)) : err(existing.error);
};

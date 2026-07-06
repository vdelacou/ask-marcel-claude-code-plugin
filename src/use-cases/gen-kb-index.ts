import { renderFolderIndex } from '../domain/kb-index.ts';
import { KB_FOLDERS, KB_ROOT } from '../domain/okf-kb.ts';
import type { KbFile } from '../domain/okf-kb.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { FileLister, ListError } from './ports/file-lister.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type GenKbIndexError = ListError | ReadError | WriteError;

export type GenKbIndexSummary = { readonly folders: number };

export type GenKbIndex = () => Promise<Result<GenKbIndexSummary, GenKbIndexError>>;

type Deps = { readonly lister: FileLister; readonly reader: FileReader; readonly writer: FileWriter; readonly logger: Logger };

const readPages = async (deps: Deps, paths: ReadonlyArray<string>): Promise<Result<ReadonlyArray<KbFile>, GenKbIndexError>> => {
  const files: KbFile[] = [];
  for (const path of paths) {
    const read = await deps.reader.read(path);
    if (!read.ok) return err(read.error);
    files.push({ path, content: read.value });
  }
  return ok(files);
};

// Gardener Phase 1 (SPEC §8): regenerate every folder's index.md from its concept pages - derived data.
export const createGenKbIndex =
  (deps: Deps): GenKbIndex =>
  async () => {
    for (const folder of KB_FOLDERS) {
      const listed = await deps.lister.list(`${KB_ROOT}/${folder.name}/*.md`);
      if (!listed.ok) return err(listed.error);
      const pages = await readPages(
        deps,
        listed.value.filter((path) => !path.endsWith('/index.md'))
      );
      if (!pages.ok) return err(pages.error);
      const written = await deps.writer.write(`${KB_ROOT}/${folder.name}/index.md`, renderFolderIndex(folder.title, pages.value));
      if (!written.ok) return err(written.error);
    }
    deps.logger.info('kb-index-regenerated', { folders: KB_FOLDERS.length });
    return ok({ folders: KB_FOLDERS.length });
  };

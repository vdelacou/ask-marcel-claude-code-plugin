import { lintKb } from '../domain/kb-lint.ts';
import type { LintIssue } from '../domain/kb-lint.ts';
import { KB_ROOT } from '../domain/okf-kb.ts';
import type { KbFile } from '../domain/okf-kb.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { FileLister, ListError } from './ports/file-lister.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { Logger } from './ports/logger.ts';

export type LintKbError = ListError | ReadError;

export type LintKbSummary = { readonly issues: ReadonlyArray<LintIssue>; readonly pagesLinted: number };

export type LintKb = () => Promise<Result<LintKbSummary, LintKbError>>;

type Deps = { readonly lister: FileLister; readonly reader: FileReader; readonly clock: Clock; readonly logger: Logger };

// Gardener Phase 1 (SPEC §8): read every KB page and report OKF-conformance issues
// (frontmatter, duplicate slugs, broken internal links, staleness >180d, orphans); read-only.
export const createLintKb =
  (deps: Deps): LintKb =>
  async () => {
    const listed = await deps.lister.list(`${KB_ROOT}/**/*.md`);
    if (!listed.ok) return err(listed.error);
    const files: KbFile[] = [];
    for (const path of listed.value) {
      const read = await deps.reader.read(path);
      if (!read.ok) return err(read.error);
      files.push({ path, content: read.value });
    }
    const issues = lintKb(files, deps.clock.todayIso());
    deps.logger.info('kb-linted', { pages: files.length, issues: issues.length });
    return ok({ issues, pagesLinted: files.length });
  };

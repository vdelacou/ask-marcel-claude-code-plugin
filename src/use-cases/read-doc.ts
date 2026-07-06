import { decodeBase64 } from '../domain/base64.ts';
import { emailIdSegment } from '../domain/bundle-path.ts';
import { assessMarkdownQuality } from '../domain/doc-quality.ts';
import { extractMarkdown } from '../domain/email-thread.ts';
import { extractBase64 } from '../domain/mail-attachments.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import { toSlug } from '../domain/slug.ts';
import type { BinaryWriter } from './ports/binary-writer.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type ReadDocRequest = { readonly runId: RunId; readonly emailId: string; readonly name: string; readonly driveId: string; readonly itemId: string };

export type ReadDocError = { readonly kind: 'convert-failed'; readonly message: string } | { readonly kind: 'pdf-fallback-failed'; readonly message: string } | WriteError;

export type ReadDocSummary = { readonly mode: 'markdown' | 'pdf'; readonly path: string };

export type ReadDoc = (request: ReadDocRequest) => Promise<Result<ReadDocSummary, ReadDocError>>;

type Deps = { readonly office: Office; readonly writer: FileWriter; readonly binaryWriter: BinaryWriter; readonly logger: Logger };

const driveParams = (request: ReadDocRequest): Record<string, string> => ({ driveId: request.driveId, itemId: request.itemId });

// Scanned or table-mangled documents convert to scrambled markdown; render the PDF instead so the
// researcher reads its pages as images (SPEC §7 read-document rule).
const pdfFallback = async (deps: Deps, request: ReadDocRequest, bundleDir: string): Promise<Result<ReadDocSummary, ReadDocError>> => {
  const run = await deps.office.execute('download-drive-item-as-pdf', driveParams(request));
  if (!run.ok) return err({ kind: 'pdf-fallback-failed', message: run.error.message });
  const base64 = extractBase64(run.value);
  if (!base64.ok) return err({ kind: 'pdf-fallback-failed', message: base64.error });
  const decoded = decodeBase64(base64.value);
  if (!decoded.ok) return err({ kind: 'pdf-fallback-failed', message: decoded.error });
  const path = `docs/${toSlug(request.name)}.pdf`;
  const written = await deps.binaryWriter.write(`${bundleDir}/${path}`, decoded.value);
  return written.ok ? ok({ mode: 'pdf', path }) : err(written.error);
};

export const createReadDoc =
  (deps: Deps): ReadDoc =>
  async (request) => {
    const bundleDir = `data/scratch/${request.runId}/${emailIdSegment(request.emailId)}/bundle`;
    const run = await deps.office.execute('download-drive-item-as-markdown', driveParams(request));
    if (!run.ok) return err({ kind: 'convert-failed', message: run.error.message });
    const markdown = extractMarkdown(run.value);
    // A poor conversion (empty or scrambled) routes to the PDF path; a clean one lands as markdown.
    if (markdown.ok && assessMarkdownQuality(markdown.value) === 'good') {
      const path = `docs/${toSlug(request.name)}.md`;
      const written = await deps.writer.write(`${bundleDir}/${path}`, markdown.value);
      if (!written.ok) return err(written.error);
      deps.logger.info('read-doc', { name: request.name, mode: 'markdown' });
      return ok({ mode: 'markdown', path });
    }
    const fallback = await pdfFallback(deps, request, bundleDir);
    if (fallback.ok) deps.logger.info('read-doc', { name: request.name, mode: 'pdf' });
    return fallback;
  };

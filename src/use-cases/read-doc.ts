import { decodeBase64 } from '../domain/base64.ts';
import { emailIdSegment } from '../domain/bundle-path.ts';
import { extractDocImages, flattenDocImagePath } from '../domain/doc-images.ts';
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

export type ReadDocSummary = { readonly mode: 'markdown' | 'pdf'; readonly path: string; readonly images: number };

export type ReadDoc = (request: ReadDocRequest) => Promise<Result<ReadDocSummary, ReadDocError>>;

type Deps = { readonly office: Office; readonly writer: FileWriter; readonly binaryWriter: BinaryWriter; readonly logger: Logger };

const pad = (value: number): string => String(value).padStart(2, '0');

const driveParams = (request: ReadDocRequest): Record<string, string> => ({ driveId: request.driveId, itemId: request.itemId });

// A clean markdown conversion drops embedded images to `[image]` placeholders; pull the originals
// alongside it so the researcher can read the figures too (SPEC §7, Img-B). Best-effort by design:
// every failure is a logged warning and never fails the read — the markdown is the deliverable.
const extractImages = async (deps: Deps, request: ReadDocRequest, bundleDir: string, slug: string): Promise<number> => {
  const run = await deps.office.execute('extract-drive-item-images', driveParams(request));
  if (!run.ok) {
    deps.logger.warn('read-doc-images', { name: request.name, message: run.error.message });
    return 0;
  }
  let saved = 0;
  for (const [index, image] of extractDocImages(run.value).entries()) {
    const decoded = decodeBase64(image.base64);
    if (!decoded.ok) {
      deps.logger.warn('read-doc-images', { name: request.name, message: decoded.error });
      continue;
    }
    const path = `${bundleDir}/docs/${slug}-images/${pad(index + 1)}-${flattenDocImagePath(image.path)}`;
    const written = await deps.binaryWriter.write(path, decoded.value);
    if (written.ok) saved += 1;
    else deps.logger.warn('read-doc-images', { name: request.name, message: written.error.message });
  }
  return saved;
};

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
  return written.ok ? ok({ mode: 'pdf', path, images: 0 }) : err(written.error);
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
      const slug = toSlug(request.name);
      const path = `docs/${slug}.md`;
      const written = await deps.writer.write(`${bundleDir}/${path}`, markdown.value);
      if (!written.ok) return err(written.error);
      const images = await extractImages(deps, request, bundleDir, slug);
      deps.logger.info('read-doc', { name: request.name, mode: 'markdown', images });
      return ok({ mode: 'markdown', path, images });
    }
    const fallback = await pdfFallback(deps, request, bundleDir);
    if (fallback.ok) deps.logger.info('read-doc', { name: request.name, mode: 'pdf' });
    return fallback;
  };

import { describe, expect, test } from 'bun:test';

import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import type { OfficeError } from './ports/office.ts';
import { createReadDoc } from './read-doc.ts';
import type { ReadDocRequest } from './read-doc.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const REQUEST: ReadDocRequest = { runId: RUN_ID, emailId: 'msg-2', name: 'Q3 Plan.docx', driveId: 'd1', itemId: 'i1' };
const BASE = `data/scratch/${RUN_ID}/msg-2/bundle`;

type OfficeResp = Result<unknown, OfficeError>;
type Written = { readonly path: string; readonly content: string };
type BinaryWritten = { readonly path: string; readonly bytes: Uint8Array };
type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

type Overrides = { readonly markdown?: OfficeResp; readonly pdf?: OfficeResp; readonly images?: OfficeResp; readonly failWrite?: (path: string) => boolean };

const GOOD_MD = '# Q3 Plan\n\nThe quarterly envelope was approved by the committee and rolls out next week.';
const markdownData = (text: string): OfficeResp => ok({ contentType: 'text/markdown', size: text.length, text });
const pdfData = (base64: string): OfficeResp => ok({ contentType: 'application/pdf', size: 3, base64 });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

type Setup = {
  readonly readDoc: ReturnType<typeof createReadDoc>;
  readonly written: ReadonlyArray<Written>;
  readonly binaryWritten: ReadonlyArray<BinaryWritten>;
  readonly officeLog: ReadonlyArray<OfficeCall>;
  readonly logger: LoggerFake;
};

const setup = (overrides: Overrides = {}): Setup => {
  const written: Written[] = [];
  const binaryWritten: BinaryWritten[] = [];
  const officeLog: OfficeCall[] = [];
  const logger = createLoggerFake();
  const readDoc = createReadDoc({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        if (command === 'download-drive-item-as-markdown') return overrides.markdown ?? markdownData(GOOD_MD);
        if (command === 'download-drive-item-as-pdf') return overrides.pdf ?? pdfData('iVBORw0KGgo=');
        if (command === 'extract-drive-item-images') return overrides.images ?? ok({ count: 0, media: [] });
        return err({ kind: 'unknown-command', message: command });
      },
    },
    writer: {
      write: async (path, content) => {
        if (overrides.failWrite?.(path) === true) return err({ kind: 'write-failed', path, message: 'disk full' });
        written.push({ path, content });
        return ok(undefined);
      },
    },
    binaryWriter: {
      write: async (path, bytes) => {
        if (overrides.failWrite?.(path) === true) return err({ kind: 'write-failed', path, message: 'disk full' });
        binaryWritten.push({ path, bytes });
        return ok(undefined);
      },
    },
    logger,
  });
  return { readDoc, written, binaryWritten, officeLog, logger };
};

describe('read-doc', () => {
  test('a cleanly converting document lands in the bundle as markdown', async () => {
    const { readDoc, written, officeLog, logger } = setup();

    const result = await readDoc(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'markdown', path: 'docs/q3-plan-docx.md', images: 0 } });
    // it converts by drive + item id, then probes for embedded images by the same ids; never the PDF renderer
    expect(officeLog).toEqual([
      { command: 'download-drive-item-as-markdown', params: { driveId: 'd1', itemId: 'i1' } },
      { command: 'extract-drive-item-images', params: { driveId: 'd1', itemId: 'i1' } },
    ]);
    expect(written.find((w) => w.path === `${BASE}/docs/q3-plan-docx.md`)?.content).toBe(GOOD_MD);
    expect(logger.calls).toEqual([{ level: 'info', event: 'read-doc', meta: { name: 'Q3 Plan.docx', mode: 'markdown', images: 0 } }]);
  });

  test('a scrambled conversion falls back to rendering the PDF pages', async () => {
    const { readDoc, written, binaryWritten, officeLog, logger } = setup({ markdown: markdownData('| --- | --- |\n| --- | --- |\n| --- | --- |') });

    const result = await readDoc(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'pdf', path: 'docs/q3-plan-docx.pdf', images: 0 } });
    // markdown first, then the PDF fallback, both by drive + item id
    expect(officeLog).toEqual([
      { command: 'download-drive-item-as-markdown', params: { driveId: 'd1', itemId: 'i1' } },
      { command: 'download-drive-item-as-pdf', params: { driveId: 'd1', itemId: 'i1' } },
    ]);
    // no markdown file is written; the decoded PDF bytes land via the binary writer
    expect(written.some((w) => w.path.endsWith('.md'))).toBe(false);
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/docs/q3-plan-docx.pdf`]);
    expect([...(binaryWritten[0]?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'read-doc', meta: { name: 'Q3 Plan.docx', mode: 'pdf' } }]);
  });

  test('an empty conversion (no text) also falls back to the PDF', async () => {
    const { readDoc, binaryWritten } = setup({ markdown: ok({ contentType: 'text/markdown', size: 0 }) });

    const result = await readDoc(REQUEST);

    expect(result.ok && result.value.mode).toBe('pdf');
    expect(binaryWritten).toHaveLength(1);
  });

  test('a markdown conversion failure surfaces as convert-failed, never reaching the PDF path', async () => {
    const { readDoc, officeLog } = setup({ markdown: commandFailed('403 forbidden') });

    expect(await readDoc(REQUEST)).toEqual({ ok: false, error: { kind: 'convert-failed', message: '403 forbidden' } });
    expect(officeLog.some((c) => c.command === 'download-drive-item-as-pdf')).toBe(false);
  });

  test('every PDF-fallback failure mode surfaces as pdf-fallback-failed', async () => {
    const scrambled = markdownData('| --- | --- |\n| --- | --- |\n| --- | --- |');
    const modes: Record<string, OfficeResp> = {
      'download error': commandFailed('gateway timeout'),
      'missing base64': ok({ contentType: 'application/pdf', size: 0 }),
      'undecodable base64': pdfData('not valid base64 !!!'),
    };
    for (const [, pdf] of Object.entries(modes)) {
      const { readDoc } = setup({ markdown: scrambled, pdf });
      const result = await readDoc(REQUEST);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('pdf-fallback-failed');
    }
  });

  test('a failed write of either the markdown or the PDF surfaces as a typed write error', async () => {
    const mdWriteFails = setup({ failWrite: (path) => path.endsWith('.md') });
    expect(await mdWriteFails.readDoc(REQUEST)).toEqual({ ok: false, error: { kind: 'write-failed', path: `${BASE}/docs/q3-plan-docx.md`, message: 'disk full' } });

    const pdfWriteFails = setup({ markdown: markdownData('| --- | --- |\n| --- | --- |\n| --- | --- |'), failWrite: (path) => path.endsWith('.pdf') });
    expect(await pdfWriteFails.readDoc(REQUEST)).toEqual({ ok: false, error: { kind: 'write-failed', path: `${BASE}/docs/q3-plan-docx.pdf`, message: 'disk full' } });
  });

  test('a document name in any script slugs safely and still writes', async () => {
    const { readDoc, written } = setup({ markdown: markdownData('# 年度报告\n\n本年度的预算已获管理委员会批准，详见随附文件。') });

    const result = await readDoc({ ...REQUEST, name: '年度报告.docx' });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.path).toBe('docs/年度报告-docx.md');
    expect(written.find((w) => w.path === `${BASE}/docs/年度报告-docx.md`)).toBeDefined();
  });

  test('a document with embedded images pulls the full-resolution originals alongside its markdown', async () => {
    const { readDoc, written, binaryWritten, officeLog, logger } = setup({
      images: ok({
        count: 2,
        media: [
          { path: 'ppt/media/image1.png', contentType: 'image/png', sizeBytes: 8, base64: 'iVBORw0KGgo=' },
          { path: 'word/media/image2.png', contentType: 'image/png', sizeBytes: 3, base64: 'AAAA' },
        ],
      }),
    });

    const result = await readDoc(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'markdown', path: 'docs/q3-plan-docx.md', images: 2 } });
    // markdown first, then the originals pulled by the same drive + item id
    expect(officeLog).toEqual([
      { command: 'download-drive-item-as-markdown', params: { driveId: 'd1', itemId: 'i1' } },
      { command: 'extract-drive-item-images', params: { driveId: 'd1', itemId: 'i1' } },
    ]);
    // only the markdown lands as text; the decoded image bytes go through the binary writer, grouped by doc slug
    expect(written.map((w) => w.path)).toEqual([`${BASE}/docs/q3-plan-docx.md`]);
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/docs/q3-plan-docx-images/01-ppt_media_image1.png`, `${BASE}/docs/q3-plan-docx-images/02-word_media_image2.png`]);
    expect([...(binaryWritten[0]?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'read-doc', meta: { name: 'Q3 Plan.docx', mode: 'markdown', images: 2 } }]);
  });

  test('a failed image extraction never fails the markdown read, only warns', async () => {
    const { readDoc, binaryWritten, logger } = setup({ images: commandFailed('image pipeline 500') });

    const result = await readDoc(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'markdown', path: 'docs/q3-plan-docx.md', images: 0 } });
    expect(binaryWritten).toHaveLength(0);
    expect(logger.calls).toEqual([
      { level: 'warn', event: 'read-doc-images', meta: { name: 'Q3 Plan.docx', message: 'image pipeline 500' } },
      { level: 'info', event: 'read-doc', meta: { name: 'Q3 Plan.docx', mode: 'markdown', images: 0 } },
    ]);
  });

  test('an undecodable embedded image is skipped, its sibling still lands', async () => {
    const { readDoc, binaryWritten, logger } = setup({
      images: ok({
        count: 2,
        media: [
          { path: 'a/bad.png', base64: 'not valid base64 !!!' },
          { path: 'a/good.png', base64: 'iVBORw0KGgo=' },
        ],
      }),
    });

    const result = await readDoc(REQUEST);

    expect(result.ok && result.value.images).toBe(1);
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/docs/q3-plan-docx-images/02-a_good.png`]);
    const warn = logger.calls.find((c) => c.level === 'warn' && c.event === 'read-doc-images');
    expect(warn?.meta?.name).toBe('Q3 Plan.docx');
  });

  test('a failed image write is skipped without failing the read', async () => {
    const { readDoc, logger } = setup({
      images: ok({ count: 1, media: [{ path: 'a/img.png', base64: 'iVBORw0KGgo=' }] }),
      failWrite: (path) => path.includes('-images/'),
    });

    const result = await readDoc(REQUEST);

    expect(result).toEqual({ ok: true, value: { mode: 'markdown', path: 'docs/q3-plan-docx.md', images: 0 } });
    const warn = logger.calls.find((c) => c.level === 'warn' && c.event === 'read-doc-images');
    expect(warn?.meta).toEqual({ name: 'Q3 Plan.docx', message: 'disk full' });
  });
});

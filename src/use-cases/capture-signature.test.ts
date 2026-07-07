import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createOfficeFake } from '../test-helpers/office-fake.ts';
import type { OfficeFake } from '../test-helpers/office-fake.ts';
import { createCaptureSignature } from './capture-signature.ts';
import type { CaptureSignature } from './capture-signature.ts';
import type { WriteError } from './ports/file-writer.ts';
import type { OfficeError } from './ports/office.ts';

type Resp = Result<unknown, OfficeError>;
type Written = { readonly path: string; readonly content: string };
const PATH = 'data/profile/draft-template.html';

// a sent email with a reply body, a signature block (one cid logo), then quoted history
const SIG_HTML = '<div>reply body</div><div id="Signature"><p>Vincent</p><img src="cid:logo@x"></div><div id="appendonsend">quoted</div>';

type Overrides = { readonly sent?: Resp; readonly attachments?: Resp; readonly attachment?: Resp; readonly failWrite?: boolean };

type Setup = { readonly capture: CaptureSignature; readonly written: ReadonlyArray<Written>; readonly office: OfficeFake; readonly logger: LoggerFake };

const setup = (overrides: Overrides = {}): Setup => {
  const written: Written[] = [];
  const logger = createLoggerFake();
  const office = createOfficeFake({
    'list-mail-folder-messages': async () => overrides.sent ?? ok({ value: [{ id: 'm2', subject: 'Re: hi', body: { content: SIG_HTML } }] }),
    'list-mail-attachments': async () =>
      overrides.attachments ??
      ok({
        value: [
          { id: 'att-1', name: 'logo.png', contentType: 'image/png', size: 10, isInline: true },
          { id: 'att-2', name: 'doc.pdf', contentType: 'application/pdf', size: 99, isInline: false },
        ],
      }),
    'get-mail-attachment': async () => overrides.attachment ?? ok({ contentId: 'logo@x', contentType: 'image/png', base64: 'AAAA' }),
  });
  const writer = {
    write: async (path: string, content: string): Promise<Result<undefined, WriteError>> => {
      if (overrides.failWrite === true) return err({ kind: 'write-failed', path, message: 'disk full' });
      written.push({ path, content });
      return ok(undefined);
    },
  };
  return { capture: createCaptureSignature({ office, writer, logger }), written, office, logger };
};

describe('capture-signature', () => {
  test('extracts the signature from a sent email, inlines its logo, and writes the draft template', async () => {
    const { capture, written, office, logger } = setup();

    const result = await capture();

    expect(result).toEqual({ ok: true, value: { imageCount: 1, path: PATH } });
    const template = written.find((w) => w.path === PATH);
    expect(template?.content).toContain('data:image/png;base64,AAAA');
    expect(template?.content).toContain('{{BODY}}');
    expect(template?.content.includes('cid:')).toBe(false);
    // read sent items, list attachments, fetch ONLY the inline logo (att-2, not inline, is skipped)
    expect(office.calls).toEqual([
      { command: 'list-mail-folder-messages', params: { mailFolderId: 'sentitems', top: '40', select: 'id,subject,body' } },
      { command: 'list-mail-attachments', params: { messageId: 'm2', select: 'id,name,contentType,size,isInline' } },
      { command: 'get-mail-attachment', params: { messageId: 'm2', attachmentId: 'att-1' } },
    ]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'signature-captured', meta: { images: 1, path: PATH } }]);
  });

  test('reports no-signature when no sent email carries a signature block', async () => {
    const { capture } = setup({ sent: ok({ value: [{ id: 'm1', body: { content: '<div>plain</div>' } }] }) });
    expect(await capture()).toEqual({ ok: false, error: { kind: 'no-signature', message: 'no sent email with an id="Signature" block found' } });
  });

  test('reports no-signature when the marker is present but the block cannot be extracted', async () => {
    const { capture } = setup({ sent: ok({ value: [{ id: 'm1', body: { content: 'id="Signature">but no div' } }] }) });
    expect(await capture()).toEqual({ ok: false, error: { kind: 'no-signature', message: 'the signature block could not be extracted' } });
  });

  test('surfaces a sent-items fetch failure', async () => {
    const { capture } = setup({ sent: err({ kind: 'command-failed', message: 'graph 503' }) });
    expect(await capture()).toEqual({ ok: false, error: { kind: 'fetch-failed', message: 'graph 503' } });
  });

  test('a failed template write surfaces as a typed write error', async () => {
    const { capture } = setup({ failWrite: true });
    expect(await capture()).toEqual({ ok: false, error: { kind: 'write-failed', path: PATH, message: 'disk full' } });
  });

  test('a listing failure drops the logos but still lands the template (cid left as-is, imageCount 0)', async () => {
    const { capture, written } = setup({ attachments: err({ kind: 'command-failed', message: 'no attachments' }) });
    expect(await capture()).toEqual({ ok: true, value: { imageCount: 0, path: PATH } });
    expect(written[0]?.content.includes('cid:logo@x')).toBe(true);
  });

  test('an inline image whose fetch fails is skipped, capture still succeeds', async () => {
    const { capture } = setup({ attachment: err({ kind: 'command-failed', message: 'gone' }) });
    expect(await capture()).toEqual({ ok: true, value: { imageCount: 0, path: PATH } });
  });

  test('an inline attachment returning no bytes is skipped', async () => {
    const { capture } = setup({ attachment: ok({ contentId: 'logo@x', contentType: 'image/png' }) });
    expect(await capture()).toEqual({ ok: true, value: { imageCount: 0, path: PATH } });
  });
});

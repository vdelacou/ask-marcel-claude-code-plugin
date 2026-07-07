import { describe, expect, test } from 'bun:test';

import { parseRunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createFetchEmailBundle } from './fetch-email-bundle.ts';
import type { BundleRequest, FetchEmailBundle } from './fetch-email-bundle.ts';
import type { OfficeError } from './ports/office.ts';

const RUN_ID = unwrap(parseRunId('run-20260704-135959'));
const REQUEST: BundleRequest = { runId: RUN_ID, emailId: 'msg-2', conversationId: 'conv-abc' };
const BASE = `data/scratch/${RUN_ID}/msg-2/bundle`;

type OfficeResp = Result<unknown, OfficeError>;
type Written = { readonly path: string; readonly content: string };
type BinaryWritten = { readonly path: string; readonly bytes: Uint8Array };
type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

type Setup = {
  readonly fetchBundle: FetchEmailBundle;
  readonly written: ReadonlyArray<Written>;
  readonly binaryWritten: ReadonlyArray<BinaryWritten>;
  readonly officeLog: ReadonlyArray<OfficeCall>;
  readonly logger: LoggerFake;
};

type Overrides = {
  readonly convert?: Record<string, OfficeResp>;
  readonly attachments?: Record<string, OfficeResp>;
  readonly readAttachment?: Record<string, OfficeResp>;
  readonly sharepointLinks?: Record<string, OfficeResp>;
  readonly sharepointDoc?: Record<string, OfficeResp>;
  readonly getAttachment?: Record<string, OfficeResp>;
  readonly failWrite?: (path: string) => boolean;
};

// The library returns each command's data object directly — no CLI envelope, no exit code.
const threadData = (messages: ReadonlyArray<unknown>): OfficeResp => ok({ value: messages });
const markdownData = (text: string): OfficeResp => ok({ contentType: 'text/markdown', size: text.length, text });
const attachmentsData = (list: ReadonlyArray<unknown>): OfficeResp => ok({ value: list });
const sharepointData = (links: ReadonlyArray<unknown>): OfficeResp => ok({ links });
const imageData = (base64: string): OfficeResp => ok({ contentType: 'image/png', size: 1, base64 });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

const setup = (thread: OfficeResp, markdownById: Record<string, string>, overrides: Overrides = {}): Setup => {
  const written: Written[] = [];
  const binaryWritten: BinaryWritten[] = [];
  const officeLog: OfficeCall[] = [];
  const logger = createLoggerFake();
  const fetchBundle = createFetchEmailBundle({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        const messageId = params['messageId'];
        const attachmentId = params['attachmentId'];
        if (command === 'list-conversation-messages') return thread;
        if (command === 'convert-mail-to-markdown') return overrides.convert?.[messageId] ?? markdownData(markdownById[messageId] ?? '');
        if (command === 'list-mail-attachments') return overrides.attachments?.[messageId] ?? attachmentsData([]);
        if (command === 'read-mail-attachment') return overrides.readAttachment?.[attachmentId] ?? markdownData('');
        if (command === 'extract-sharepoint-links-in-mail') return overrides.sharepointLinks?.[messageId] ?? sharepointData([]);
        if (command === 'download-drive-item-as-markdown') return overrides.sharepointDoc?.[params['itemId']] ?? markdownData(`doc ${params['itemId']}`);
        if (command === 'get-mail-attachment') return overrides.getAttachment?.[attachmentId] ?? imageData('iVBORw0KGgo=');
        return err({ kind: 'unknown-command', message: `unknown: ${command}` });
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
  return { fetchBundle, written, binaryWritten, officeLog, logger };
};

const messageOf = (id: string, receivedDateTime: string, hasAttachments: boolean): Record<string, unknown> => ({
  id,
  subject: `Subject ${id}`,
  from: { emailAddress: { address: `${id}@x.com` } },
  receivedDateTime,
  hasAttachments,
});

const manifestOf = (written: ReadonlyArray<Written>): { messages: ReadonlyArray<Record<string, unknown>> } => {
  const manifestFile = written.find((w) => w.path.endsWith('manifest.json'));
  if (manifestFile === undefined) throw new Error('manifest.json not written');
  return JSON.parse(manifestFile.content);
};

describe('fetch-email-bundle', () => {
  test('researching an approved email pulls its whole thread, writes each message as markdown, and manifests them in chronological order', async () => {
    // thread comes back UNORDERED (reply before original) to prove client-side chronological sort
    const thread = [
      { id: 'msg-2', subject: 'RE: Q3 envelope', from: { emailAddress: { name: 'Jane', address: 'Jane@X.com' } }, receivedDateTime: '2026-07-02T10:00:00Z', hasAttachments: false },
      {
        id: 'msg-1',
        subject: 'Q3 envelope',
        from: { emailAddress: { name: 'Vincent', address: 'v@example.com' } },
        receivedDateTime: '2026-07-01T09:00:00Z',
        hasAttachments: true,
      },
    ];
    const markdown = { 'msg-1': '**Subject:** Q3 envelope\n\nOriginal body', 'msg-2': '**Subject:** RE: Q3 envelope\n\nReply body' };
    const { fetchBundle, written, officeLog, logger } = setup(threadData(thread), markdown);

    const result = await fetchBundle({ runId: RUN_ID, emailId: 'msg-2', conversationId: 'conv-abc' });

    // 1. correct command ladder, message by message: convert body, list attachments (only when present), extract SharePoint links
    expect(officeLog).toEqual([
      { command: 'list-conversation-messages', params: { conversationId: 'conv-abc', top: '50', select: 'id,subject,from,receivedDateTime,hasAttachments' } },
      { command: 'convert-mail-to-markdown', params: { messageId: 'msg-1', inlineImages: 'false' } },
      { command: 'list-mail-attachments', params: { messageId: 'msg-1', select: 'id,name,contentType,size,isInline' } },
      { command: 'extract-sharepoint-links-in-mail', params: { messageId: 'msg-1' } },
      { command: 'convert-mail-to-markdown', params: { messageId: 'msg-2', inlineImages: 'false' } },
      { command: 'extract-sharepoint-links-in-mail', params: { messageId: 'msg-2' } },
    ]);

    // 2. each message written as markdown, numbered chronologically
    expect(written.find((w) => w.path === `${BASE}/messages/01-msg-1.md`)?.content).toBe('**Subject:** Q3 envelope\n\nOriginal body');
    expect(written.find((w) => w.path === `${BASE}/messages/02-msg-2.md`)?.content).toBe('**Subject:** RE: Q3 envelope\n\nReply body');

    // 3. manifest lists every artifact + conversion status, bundle-relative paths, no silent failures
    const manifestFile = written.find((w) => w.path === `${BASE}/manifest.json`);
    if (manifestFile === undefined) throw new Error('manifest.json not written');
    expect(JSON.parse(manifestFile.content)).toEqual({
      emailId: 'msg-2',
      conversationId: 'conv-abc',
      messages: [
        {
          order: 1,
          messageId: 'msg-1',
          subject: 'Q3 envelope',
          from: 'v@example.com',
          receivedDateTime: '2026-07-01T09:00:00Z',
          hasAttachments: true,
          path: 'messages/01-msg-1.md',
          status: 'converted',
          attachments: [],
          sharepointDocs: [],
        },
        {
          order: 2,
          messageId: 'msg-2',
          subject: 'RE: Q3 envelope',
          from: 'jane@x.com',
          receivedDateTime: '2026-07-02T10:00:00Z',
          hasAttachments: false,
          path: 'messages/02-msg-2.md',
          status: 'converted',
          attachments: [],
          sharepointDocs: [],
        },
      ],
    });

    // 4. compact summary handed back to the researcher orchestration, and the run is logged
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 2, threadHasAttachments: true });
    expect(logger.calls).toEqual([{ level: 'info', event: 'bundle-fetched', meta: { emailId: 'msg-2', messageCount: 2 } }]);
  });

  test('an IO failure at any step surfaces as a typed error, never a crash', async () => {
    const commandDown = setup(commandFailed('EPERM'), {});
    expect(await commandDown.fetchBundle(REQUEST)).toEqual({ ok: false, error: { kind: 'thread-fetch-failed', message: 'EPERM' } });

    // a message-file write and the manifest write each surface as write-failed
    const oneMessage = [messageOf('m', '2026-07-01T00:00:00Z', false)];
    const messageWriteFails = setup(threadData(oneMessage), { m: 'body' }, { failWrite: (path) => path.endsWith('.md') });
    expect(await messageWriteFails.fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `${BASE}/messages/01-m.md`, message: 'disk full' },
    });

    const manifestWriteFails = setup(threadData(oneMessage), { m: 'body' }, { failWrite: (path) => path.endsWith('manifest.json') });
    expect(await manifestWriteFails.fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `${BASE}/manifest.json`, message: 'disk full' },
    });
  });

  test('a message that fails to convert is manifested as failed and writes no file, while the rest still bundle', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', false), messageOf('m2', '2026-07-02T00:00:00Z', false)];
    // both the library-error path and every malformed-data shape land as status 'failed'
    const failModes: Record<string, OfficeResp> = {
      'command failed': commandFailed('boom'),
      'data not a record': ok('oops'),
      'missing text': ok({ contentType: 'text/markdown', size: 0 }),
      'empty text': ok({ contentType: 'text/markdown', size: 0, text: '' }),
    };

    for (const [label, response] of Object.entries(failModes)) {
      const { fetchBundle, written } = setup(threadData(thread), { m1: 'good body' }, { convert: { m2: response } });
      const result = await fetchBundle(REQUEST);
      if (!result.ok) throw new Error(`expected ok for ${label}`);
      expect(result.value.threadHasAttachments).toBe(false);
      const statuses = manifestOf(written).messages.map((message) => message['status']);
      expect(statuses).toEqual(['converted', 'failed']);
      // exactly the one good body plus the manifest are written — a failed convert contributes no file
      expect(written.map((w) => w.path)).toEqual([`${BASE}/messages/01-m1.md`, `${BASE}/manifest.json`]);
    }
  });

  test('malformed thread entries are skipped and missing fields fall back to defaults', async () => {
    const thread = [
      messageOf('ok1', '2026-07-01T00:00:00Z', false),
      'not-a-record',
      null,
      { subject: 'neither id nor sender', receivedDateTime: '2026-07-02T00:00:00Z' },
      { id: 'has-id-no-sender', subject: 'orphan' },
      { from: { emailAddress: { address: 'z@z.com' } }, subject: 'sender-but-no-id' },
      { id: 'ok2', from: { emailAddress: { address: 'C@D.com' } }, hasAttachments: false },
    ];
    const { fetchBundle, written } = setup(threadData(thread), { ok1: 'b1', ok2: 'b2' });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.messageCount).toBe(2);
    const messages = manifestOf(written).messages;
    expect(messages).toHaveLength(2);
    const defaulted = messages.find((message) => message['messageId'] === 'ok2');
    expect(defaulted).toEqual({
      order: 1,
      messageId: 'ok2',
      subject: '(no subject)',
      from: 'c@d.com',
      receivedDateTime: '',
      hasAttachments: false,
      path: 'messages/01-ok2.md',
      status: 'converted',
      attachments: [],
      sharepointDocs: [],
    });
  });

  test('a conversation with no recognizable messages yields an empty bundle, not a crash', async () => {
    const noValueArray = setup(ok({}), {});
    const emptyResult = await noValueArray.fetchBundle(REQUEST);
    if (!emptyResult.ok) throw new Error('expected ok');
    expect(emptyResult.value).toEqual({ emailId: 'msg-2', conversationId: 'conv-abc', messageCount: 0, threadHasAttachments: false });
    expect(manifestOf(noValueArray.written).messages).toEqual([]);

    const nonRecordData = setup(ok(null), {});
    const nullResult = await nonRecordData.fetchBundle(REQUEST);
    if (!nullResult.ok) throw new Error('expected ok');
    expect(nullResult.value.messageCount).toBe(0);
  });

  test('every message with attachments has its attachment metadata listed in the manifest; a message without is not queried', async () => {
    const thread = [messageOf('msg-1', '2026-07-01T00:00:00Z', true), messageOf('msg-2', '2026-07-02T00:00:00Z', false)];
    const attachments = {
      'msg-1': attachmentsData([
        { id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 12345, isInline: false },
        { id: 'att-2', name: 'logo.png', contentType: 'image/png', size: 678, isInline: true },
      ]),
    };
    const readAttachment = { 'att-1': markdownData('contract body') };
    const { fetchBundle, written, officeLog } = setup(threadData(thread), { 'msg-1': 'b1', 'msg-2': 'b2' }, { attachments, readAttachment });

    const result = await fetchBundle(REQUEST);

    // only the message that has attachments is queried
    expect(officeLog).toContainEqual({ command: 'list-mail-attachments', params: { messageId: 'msg-1', select: 'id,name,contentType,size,isInline' } });
    expect(officeLog.some((call) => call.command === 'list-mail-attachments' && call.params['messageId'] === 'msg-2')).toBe(false);

    // the manifest records each attachment's metadata, inline flag preserved (the image routes to bundle/images)
    if (!result.ok) throw new Error('expected ok');
    const messages = manifestOf(written).messages;
    expect(messages.find((message) => message['messageId'] === 'msg-1')?.['attachments']).toEqual([
      { attachmentId: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 12345, isInline: false, path: 'attachments/01-01-contract-pdf.md', status: 'converted' },
      { attachmentId: 'att-2', name: 'logo.png', contentType: 'image/png', size: 678, isInline: true, path: 'images/01-02-logo.png', status: 'image' },
    ]);
    expect(messages.find((message) => message['messageId'] === 'msg-2')?.['attachments']).toEqual([]);
  });

  test('a failed attachment listing is recorded on the message without sinking the bundle', async () => {
    const { fetchBundle, written } = setup(threadData([messageOf('m1', '2026-07-01T00:00:00Z', true)]), { m1: 'body' }, { attachments: { m1: commandFailed('boom') } });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const entry = manifestOf(written).messages[0];
    expect(entry?.['attachments']).toEqual([]);
    expect(entry?.['attachmentsError']).toBe('boom');
  });

  test('malformed attachment entries are skipped and missing fields fall back to defaults', async () => {
    const list = [{ id: 'a1', name: 'doc.pdf', contentType: 'application/pdf', size: 10, isInline: false }, 'not-a-record', null, { name: 'no-id.png' }, { id: 'a2' }];
    const { fetchBundle, written } = setup(
      threadData([messageOf('m1', '2026-07-01T00:00:00Z', true)]),
      { m1: 'body' },
      { attachments: { m1: attachmentsData(list) }, readAttachment: { a2: markdownData('a2 body') } }
    );

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const attachments = manifestOf(written).messages[0]?.['attachments'] as ReadonlyArray<Record<string, unknown>>;
    expect(attachments).toHaveLength(2);
    expect(attachments.find((attachment) => attachment['attachmentId'] === 'a2')).toEqual({
      attachmentId: 'a2',
      name: '(unnamed)',
      contentType: '',
      size: 0,
      isInline: false,
      path: 'attachments/01-02-unnamed.md',
      status: 'converted',
    });
  });

  test('each listed attachment is converted to markdown, written to the bundle, and marked converted or failed', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = {
      m1: attachmentsData([
        { id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false },
        { id: 'att-2', name: 'notes.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20, isInline: false },
      ]),
    };
    const readAttachment = {
      'att-1': markdownData('# Contract\n\nterms'),
      'att-2': commandFailed('conversion failed'),
    };
    const { fetchBundle, written, officeLog } = setup(threadData(thread), { m1: 'body' }, { attachments, readAttachment });

    const result = await fetchBundle(REQUEST);

    // every listed document is read by id
    expect(officeLog).toContainEqual({ command: 'read-mail-attachment', params: { messageId: 'm1', attachmentId: 'att-1' } });
    expect(officeLog).toContainEqual({ command: 'read-mail-attachment', params: { messageId: 'm1', attachmentId: 'att-2' } });

    if (!result.ok) throw new Error('expected ok');
    // the converted document's markdown lands in the bundle; the failed one writes no file
    expect(written.find((w) => w.path === `${BASE}/attachments/01-01-contract-pdf.md`)?.content).toBe('# Contract\n\nterms');
    expect(written.some((w) => w.path.endsWith('01-02-notes-docx.md'))).toBe(false);
    // the manifest records path + status per attachment
    expect(manifestOf(written).messages[0]?.['attachments']).toEqual([
      { attachmentId: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false, path: 'attachments/01-01-contract-pdf.md', status: 'converted' },
      {
        attachmentId: 'att-2',
        name: 'notes.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 20,
        isInline: false,
        status: 'failed',
      },
    ]);
  });

  test('a failed write of a converted attachment surfaces as a typed error', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = { m1: attachmentsData([{ id: 'att-1', name: 'contract.pdf', contentType: 'application/pdf', size: 10, isInline: false }]) };
    const readAttachment = { 'att-1': markdownData('contract body') };
    const { fetchBundle } = setup(threadData(thread), { m1: 'body' }, { attachments, readAttachment, failWrite: (path) => path.includes('/attachments/') });

    expect(await fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `${BASE}/attachments/01-01-contract-pdf.md`, message: 'disk full' },
    });
  });

  test('a resolved SharePoint link is downloaded to markdown and pathed in the manifest; an errored link is recorded untouched', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', false)];
    const sharepointLinks = {
      m1: sharepointData([
        { url: 'https://x.sharepoint.com/a', driveId: 'd1', itemId: 'i1', name: 'Spec.docx', webUrl: 'https://x.sharepoint.com/Spec.docx' },
        { url: 'https://x.sharepoint.com/bad', error: 'access denied' },
      ]),
    };
    const sharepointDoc = { i1: markdownData('# Spec\n\nthe spec body') };
    const { fetchBundle, written, officeLog } = setup(threadData(thread), { m1: 'body' }, { sharepointLinks, sharepointDoc });

    const result = await fetchBundle(REQUEST);

    // only the resolved link is downloaded, by its drive + item id; the errored one is not
    expect(officeLog).toContainEqual({ command: 'extract-sharepoint-links-in-mail', params: { messageId: 'm1' } });
    expect(officeLog).toContainEqual({ command: 'download-drive-item-as-markdown', params: { driveId: 'd1', itemId: 'i1' } });
    expect(officeLog.some((call) => call.command === 'download-drive-item-as-markdown' && call.params['driveId'] === undefined)).toBe(false);
    if (!result.ok) throw new Error('expected ok');
    // the downloaded doc lands in bundle/sharepoint, and its entry gains a path + converted status
    expect(written.find((w) => w.path === `${BASE}/sharepoint/01-01-spec-docx.md`)?.content).toBe('# Spec\n\nthe spec body');
    expect(manifestOf(written).messages[0]?.['sharepointDocs']).toEqual([
      {
        url: 'https://x.sharepoint.com/a',
        name: 'Spec.docx',
        webUrl: 'https://x.sharepoint.com/Spec.docx?web=1',
        driveId: 'd1',
        itemId: 'i1',
        path: 'sharepoint/01-01-spec-docx.md',
        status: 'converted',
      },
      { url: 'https://x.sharepoint.com/bad', error: 'access denied' },
    ]);
  });

  test('a SharePoint link that fails to download is marked failed and writes no file, keeping the bundle intact', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', false)];
    const sharepointLinks = {
      m1: sharepointData([{ url: 'https://x.sharepoint.com/a', driveId: 'd1', itemId: 'i1', name: 'Spec.docx', webUrl: 'https://x.sharepoint.com/Spec.docx' }]),
    };
    const sharepointDoc = { i1: commandFailed('403 forbidden') };
    const { fetchBundle, written } = setup(threadData(thread), { m1: 'body' }, { sharepointLinks, sharepointDoc });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(written.some((w) => w.path.includes('/sharepoint/'))).toBe(false);
    expect(manifestOf(written).messages[0]?.['sharepointDocs']).toEqual([
      { url: 'https://x.sharepoint.com/a', name: 'Spec.docx', webUrl: 'https://x.sharepoint.com/Spec.docx?web=1', driveId: 'd1', itemId: 'i1', status: 'failed' },
    ]);
  });

  test('a failed SharePoint extraction is recorded on the message without sinking the bundle', async () => {
    const { fetchBundle, written } = setup(threadData([messageOf('m1', '2026-07-01T00:00:00Z', false)]), { m1: 'body' }, { sharepointLinks: { m1: commandFailed('boom') } });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const entry = manifestOf(written).messages[0];
    expect(entry?.['sharepointDocs']).toEqual([]);
    expect(entry?.['sharepointError']).toBe('boom');
  });

  test('malformed SharePoint link entries are skipped and missing fields fall back to defaults', async () => {
    const links = [
      { url: 'https://x.sharepoint.com/ok', driveId: 'd1', itemId: 'i1', name: 'Named.docx', webUrl: 'https://x.sharepoint.com/n' },
      'not-a-record',
      null,
      { driveId: 'd9', itemId: 'i9' },
      { url: 'https://x.sharepoint.com/partial', driveId: 'd2' },
      { url: 'https://x.sharepoint.com/nameless', driveId: 'd3', itemId: 'i3' },
    ];
    const { fetchBundle, written } = setup(threadData([messageOf('m1', '2026-07-01T00:00:00Z', false)]), { m1: 'body' }, { sharepointLinks: { m1: sharepointData(links) } });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const docs = manifestOf(written).messages[0]?.['sharepointDocs'] as ReadonlyArray<Record<string, unknown>>;
    expect(docs).toHaveLength(3);
    // the itemId-less link stays errored (nothing to download); the nameless-but-resolved link still downloads
    expect(docs.find((doc) => doc['url'] === 'https://x.sharepoint.com/partial')).toEqual({ url: 'https://x.sharepoint.com/partial', error: 'unresolved' });
    expect(docs.find((doc) => doc['url'] === 'https://x.sharepoint.com/nameless')).toEqual({
      url: 'https://x.sharepoint.com/nameless',
      name: '(unnamed)',
      webUrl: 'https://x.sharepoint.com/nameless?web=1',
      driveId: 'd3',
      itemId: 'i3',
      path: 'sharepoint/01-03-unnamed.md',
      status: 'converted',
    });
  });

  test('a thread in any language or mix of languages keeps its content verbatim and slugs filenames per script', async () => {
    const thread = [
      { id: 'm1', subject: '季度报告 — Q3 التقرير', from: { emailAddress: { address: 'wang@example.com' } }, receivedDateTime: '2026-07-01T00:00:00Z', hasAttachments: true },
    ];
    const body = '# 季度报告\n\nBonjour, هذا هو التقرير الفصلي. 请查收附件。';
    const attachments = { m1: attachmentsData([{ id: 'att-1', name: 'التقرير.pdf', contentType: 'application/pdf', size: 100, isInline: false }]) };
    const readAttachment = { 'att-1': markdownData('محتوى التقرير — 附件内容') };
    const sharepointLinks = {
      m1: sharepointData([{ url: 'https://x.sharepoint.com/r', driveId: 'd1', itemId: 'i1', name: '年度报告.docx', webUrl: 'https://x.sharepoint.com/年度报告' }]),
    };
    const { fetchBundle, written } = setup(threadData(thread), { m1: body }, { attachments, readAttachment, sharepointLinks });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    // message body and attachment content are written verbatim, whatever the script or mix
    expect(written.find((w) => w.path.endsWith('messages/01-m1.md'))?.content).toBe(body);
    expect(written.find((w) => w.path === `${BASE}/attachments/01-01-التقرير-pdf.md`)?.content).toBe('محتوى التقرير — 附件内容');
    // the manifest keeps original-language names; filenames slug per script (CJK/Arabic letters kept)
    const entry = manifestOf(written).messages[0];
    expect(entry?.['subject']).toBe('季度报告 — Q3 التقرير');
    expect((entry?.['attachments'] as ReadonlyArray<unknown>)[0]).toEqual({
      attachmentId: 'att-1',
      name: 'التقرير.pdf',
      contentType: 'application/pdf',
      size: 100,
      isInline: false,
      path: 'attachments/01-01-التقرير-pdf.md',
      status: 'converted',
    });
    expect((entry?.['sharepointDocs'] as ReadonlyArray<unknown>)[0]).toEqual({
      url: 'https://x.sharepoint.com/r',
      name: '年度报告.docx',
      webUrl: 'https://x.sharepoint.com/年度报告?web=1',
      driveId: 'd1',
      itemId: 'i1',
      path: 'sharepoint/01-01-年度报告-docx.md',
      status: 'converted',
    });
    expect(written.find((w) => w.path === `${BASE}/sharepoint/01-01-年度报告-docx.md`)?.content).toBe('doc i1');
  });

  test('messages sharing a timestamp keep their original thread order', async () => {
    const thread = [messageOf('first', '2026-07-01T00:00:00Z', false), messageOf('second', '2026-07-01T00:00:00Z', false)];
    const { fetchBundle, written } = setup(threadData(thread), { first: 'a', second: 'b' });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const ids = manifestOf(written).messages.map((message) => message['messageId']);
    expect(ids).toEqual(['first', 'second']);
  });

  test('image attachments, including inline body images, are decoded to bundle/images instead of the 415-failing text converter', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = {
      m1: attachmentsData([
        { id: 'img1', name: 'chart.png', contentType: 'image/png', size: 2000, isInline: false },
        { id: 'inline1', name: 'signature.gif', contentType: 'image/gif', size: 500, isInline: true },
        { id: 'doc1', name: 'report.pdf', contentType: 'application/pdf', size: 9000, isInline: false },
      ]),
    };
    const getAttachment = { img1: imageData('iVBORw0KGgo='), inline1: imageData('R0lGOA==') };
    const readAttachment = { doc1: markdownData('# Report\n\ntext') };
    const { fetchBundle, written, binaryWritten, officeLog } = setup(threadData(thread), { m1: 'body' }, { attachments, getAttachment, readAttachment });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    // images fetched by get-mail-attachment, never sent to the text converter
    expect(officeLog).toContainEqual({ command: 'get-mail-attachment', params: { messageId: 'm1', attachmentId: 'img1' } });
    expect(officeLog).toContainEqual({ command: 'get-mail-attachment', params: { messageId: 'm1', attachmentId: 'inline1' } });
    expect(officeLog.some((call) => call.command === 'read-mail-attachment' && (call.params['attachmentId'] === 'img1' || call.params['attachmentId'] === 'inline1'))).toBe(false);
    // the document still goes through the text converter, and no image ever touches the string FileWriter
    expect(officeLog).toContainEqual({ command: 'read-mail-attachment', params: { messageId: 'm1', attachmentId: 'doc1' } });
    expect(written.some((w) => w.path.includes('/images/'))).toBe(false);
    // decoded image bytes land in the bundle via the BinaryWriter, at the numbered per-script path
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/images/01-01-chart.png`, `${BASE}/images/01-02-signature.gif`]);
    expect([...(binaryWritten.find((b) => b.path.endsWith('chart.png'))?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // manifest records each image's bundle path + an 'image' status
    expect(manifestOf(written).messages[0]?.['attachments']).toEqual([
      { attachmentId: 'img1', name: 'chart.png', contentType: 'image/png', size: 2000, isInline: false, path: 'images/01-01-chart.png', status: 'image' },
      { attachmentId: 'inline1', name: 'signature.gif', contentType: 'image/gif', size: 500, isInline: true, path: 'images/01-02-signature.gif', status: 'image' },
      { attachmentId: 'doc1', name: 'report.pdf', contentType: 'application/pdf', size: 9000, isInline: false, path: 'attachments/01-03-report-pdf.md', status: 'converted' },
    ]);
  });

  test('an image whose name is all-extension (leading dot) keeps its whole slugged name as the stem', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = { m1: attachmentsData([{ id: 'dot', name: '.chart', contentType: 'image/png', size: 1, isInline: false }]) };
    const { fetchBundle, binaryWritten } = setup(threadData(thread), { m1: 'body' }, { attachments });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/images/01-01-chart.png`]);
  });

  test('an image that fails to fetch, is missing its bytes, or carries malformed bytes is marked failed; an extensionless name takes its extension from the content type', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = {
      m1: attachmentsData([
        { id: 'fetchfail', name: 'a.png', contentType: 'image/png', size: 1, isInline: false },
        { id: 'nobytes', name: 'b.png', contentType: 'image/png', size: 1, isInline: false },
        { id: 'badbytes', name: 'c.png', contentType: 'image/png', size: 1, isInline: false },
        { id: 'noext', name: 'screenshot', contentType: 'image/jpeg', size: 2, isInline: true },
      ]),
    };
    const getAttachment = {
      fetchfail: commandFailed('not found'),
      nobytes: ok({ contentType: 'image/png', size: 1 }),
      badbytes: ok({ contentType: 'image/png', size: 1, base64: 'not valid base64 !!!' }),
    };
    const { fetchBundle, written, binaryWritten } = setup(threadData(thread), { m1: 'body' }, { attachments, getAttachment });

    const result = await fetchBundle(REQUEST);

    if (!result.ok) throw new Error('expected ok');
    const atts = manifestOf(written).messages[0]?.['attachments'] as ReadonlyArray<Record<string, unknown>>;
    // all three failure modes (command error, missing base64, undecodable base64) write no file and record status 'failed'
    expect(atts[0]).toEqual({ attachmentId: 'fetchfail', name: 'a.png', contentType: 'image/png', size: 1, isInline: false, status: 'failed' });
    expect(atts[1]).toEqual({ attachmentId: 'nobytes', name: 'b.png', contentType: 'image/png', size: 1, isInline: false, status: 'failed' });
    expect(atts[2]).toEqual({ attachmentId: 'badbytes', name: 'c.png', contentType: 'image/png', size: 1, isInline: false, status: 'failed' });
    // the extensionless image still succeeds, taking .jpeg from the content type
    expect(atts[3]).toEqual({
      attachmentId: 'noext',
      name: 'screenshot',
      contentType: 'image/jpeg',
      size: 2,
      isInline: true,
      path: 'images/01-04-screenshot.jpeg',
      status: 'image',
    });
    expect(binaryWritten.map((b) => b.path)).toEqual([`${BASE}/images/01-04-screenshot.jpeg`]);
  });

  test('a failed write of a decoded image surfaces as a typed error', async () => {
    const thread = [messageOf('m1', '2026-07-01T00:00:00Z', true)];
    const attachments = { m1: attachmentsData([{ id: 'img1', name: 'chart.png', contentType: 'image/png', size: 10, isInline: false }]) };
    const { fetchBundle } = setup(threadData(thread), { m1: 'body' }, { attachments, failWrite: (path) => path.includes('/images/') });

    expect(await fetchBundle(REQUEST)).toEqual({
      ok: false,
      error: { kind: 'write-failed', path: `${BASE}/images/01-01-chart.png`, message: 'disk full' },
    });
  });
});

import { describe, expect, test } from 'bun:test';

import { extractAttachments, extractBase64 } from './mail-attachments.ts';

// The use-case swallows both extractors' failure detail into a 'failed'/empty outcome, so these
// contracts (malformed shapes, exact error messages) are pinned directly here.
describe('extractAttachments', () => {
  test('a well-formed listing maps each attachment, defaulting missing fields', () => {
    const data = {
      value: [{ id: 'a1', name: 'doc.pdf', contentType: 'application/pdf', size: 42, isInline: false }, { id: 'a2' }],
    };

    expect(extractAttachments(data)).toEqual([
      { attachmentId: 'a1', name: 'doc.pdf', contentType: 'application/pdf', size: 42, isInline: false },
      { attachmentId: 'a2', name: '(unnamed)', contentType: '', size: 0, isInline: false },
    ]);
  });

  test('a non-record payload yields an empty list, never a crash', () => {
    expect(extractAttachments('nope')).toEqual([]);
    expect(extractAttachments(null)).toEqual([]);
  });

  test('a record whose value is not an array yields an empty list', () => {
    expect(extractAttachments({})).toEqual([]);
    expect(extractAttachments({ value: 'not-an-array' })).toEqual([]);
  });
});

describe('extractBase64', () => {
  test('returns the base64 mirror when present', () => {
    expect(extractBase64({ contentType: 'image/png', size: 3, base64: 'iVBORw==' })).toEqual({ ok: true, value: 'iVBORw==' });
  });

  test('a non-record payload is a typed unexpected-shape error', () => {
    expect(extractBase64('nope')).toEqual({ ok: false, error: 'attachment-bytes: unexpected shape' });
    expect(extractBase64(null)).toEqual({ ok: false, error: 'attachment-bytes: unexpected shape' });
  });

  test('a record without a base64 field is a typed missing-bytes error', () => {
    expect(extractBase64({ contentType: 'image/png', size: 3 })).toEqual({ ok: false, error: 'attachment-bytes: missing base64' });
    // an empty base64 string is treated as absent (asString drops '')
    expect(extractBase64({ base64: '' })).toEqual({ ok: false, error: 'attachment-bytes: missing base64' });
  });
});

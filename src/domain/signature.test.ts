import { describe, expect, test } from 'bun:test';

import { buildDraftTemplate, extractInlineImage, extractSignatureBlock, findSignatureMessage, inlineCidImages } from './signature.ts';

describe('findSignatureMessage', () => {
  test('finds the first sent message whose HTML body carries a signature block', () => {
    const data = {
      value: [
        { id: 'm1', body: { content: '<div>no sig here</div>' } },
        { id: 'm2', body: { content: '<div id="Signature">sig</div>' } },
      ],
    };
    expect(findSignatureMessage(data)).toEqual({ id: 'm2', htmlBody: '<div id="Signature">sig</div>' });
  });

  test('returns undefined for a non-record, a non-array value, and every malformed or unqualified entry', () => {
    expect(findSignatureMessage('nope')).toBeUndefined();
    expect(findSignatureMessage({ value: 5 })).toBeUndefined();
    expect(
      findSignatureMessage({
        value: [
          'not-a-record',
          { body: { content: '<div id="Signature">x</div>' } }, // qualifying content but no id
          { id: 'm1', body: { content: 'no marker here' } }, // has id + body but no signature marker
          { id: 'm2' }, // has id but no body, so no content
        ],
      })
    ).toBeUndefined();
  });
});

describe('extractInlineImage', () => {
  test('pulls contentId, contentType and base64 from a get-mail-attachment result', () => {
    expect(extractInlineImage({ contentId: 'logo@x', contentType: 'image/png', base64: 'AAAA' })).toEqual({ contentId: 'logo@x', contentType: 'image/png', base64: 'AAAA' });
  });

  test('returns undefined when a required field is missing or the payload is not a record', () => {
    expect(extractInlineImage({ contentId: 'x', contentType: 'image/png' })).toBeUndefined();
    expect(extractInlineImage('nope')).toBeUndefined();
  });
});

describe('extractSignatureBlock', () => {
  test('extracts the balanced div id="Signature" block, nested divs and all', () => {
    const html = '<div>reply</div><div id="Signature"><p>Vincent</p><div>CIO</div></div><div id="appendonsend">quoted</div>';
    expect(extractSignatureBlock(html)).toBe('<div id="Signature"><p>Vincent</p><div>CIO</div></div>');
  });

  test('returns undefined when there is no signature marker', () => {
    expect(extractSignatureBlock('<div>just a reply</div>')).toBeUndefined();
  });

  test('handles a signature div that does not start at index 0', () => {
    expect(extractSignatureBlock(' <div id="Signature">sig</div>')).toBe('<div id="Signature">sig</div>');
  });

  test('returns undefined when the marker has no opening div before it', () => {
    expect(extractSignatureBlock('id="Signature">orphaned')).toBeUndefined();
  });

  test('returns undefined when the signature div is never closed', () => {
    expect(extractSignatureBlock('<div id="Signature"><div>unterminated')).toBeUndefined();
  });

  test('returns undefined when the closing tag is truncated', () => {
    expect(extractSignatureBlock('<div id="Signature">content</div')).toBeUndefined();
  });
});

describe('inlineCidImages', () => {
  test('replaces every cid reference with a self-contained base64 data URI', () => {
    const html = '<img src="cid:logo1@x"> and <img src="cid:logo2@y">';
    const images = [
      { contentId: 'logo1@x', contentType: 'image/png', base64: 'AAAA' },
      { contentId: '<logo2@y>', contentType: 'image/jpeg', base64: 'BBBB' },
    ];
    expect(inlineCidImages(html, images)).toBe('<img src="data:image/png;base64,AAAA"> and <img src="data:image/jpeg;base64,BBBB">');
  });

  test('leaves a cid reference with no matching image untouched', () => {
    expect(inlineCidImages('<img src="cid:missing">', [])).toBe('<img src="cid:missing">');
  });
});

describe('buildDraftTemplate', () => {
  test('wraps the {{BODY}} marker in the Aptos style and appends the signature', () => {
    const template = buildDraftTemplate('<div id="Signature">sig</div>');
    expect(template).toContain('font-family: Aptos, Calibri, sans-serif; font-size: 11pt; color: #000000;');
    expect(template).toContain('{{BODY}}');
    expect(template.endsWith('<div id="Signature">sig</div>\n')).toBe(true);
  });
});

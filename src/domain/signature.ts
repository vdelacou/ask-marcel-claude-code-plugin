// Capturing the user's email signature (SPEC §13, setup): Outlook wraps it in <div id="Signature">…</div>
// with cid: logo images. These pure helpers lift that block out of a sent message and make it
// self-contained (base64 data URIs) so it can be dropped into every draft.
import { asString, isRecord } from './graph-envelopes.ts';

// list-mail-folder-messages over sent items: find the first message whose HTML body has a signature block.
export const findSignatureMessage = (data: unknown): { readonly id: string; readonly htmlBody: string } | undefined => {
  if (!isRecord(data) || !Array.isArray(data['value'])) return undefined;
  for (const message of data['value']) {
    if (!isRecord(message)) continue;
    const id = asString(message['id']);
    const body = isRecord(message['body']) ? message['body'] : undefined;
    const content = body === undefined ? undefined : asString(body['content']);
    if (id !== undefined && content !== undefined && content.includes('id="Signature"')) return { id, htmlBody: content };
  }
  return undefined;
};

const stripBrackets = (value: string): string => {
  const noOpen = value.startsWith('<') ? value.slice(1) : value;
  return noOpen.endsWith('>') ? noOpen.slice(0, -1) : noOpen;
};

// Walk <div>/</div> depth from the signature marker to its matching close, so nested divs are kept whole.
export const extractSignatureBlock = (html: string): string | undefined => {
  const marker = html.indexOf('id="Signature"');
  if (marker === -1) return undefined;
  const open = html.lastIndexOf('<div', marker);
  if (open === -1) return undefined;
  let depth = 0;
  let cursor = open;
  let nextClose = html.indexOf('</div', cursor);
  while (nextClose !== -1) {
    const nextOpen = html.indexOf('<div', cursor);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
    } else {
      depth -= 1;
      cursor = nextClose + 5;
      if (depth === 0) {
        const gt = html.indexOf('>', nextClose);
        return gt === -1 ? undefined : html.slice(open, gt + 1);
      }
    }
    nextClose = html.indexOf('</div', cursor);
  }
  return undefined;
};

export type InlineImage = { readonly contentId: string; readonly contentType: string; readonly base64: string };

// Replace each cid: reference with a base64 data URI so the signature carries its own images.
export const inlineCidImages = (html: string, images: ReadonlyArray<InlineImage>): string =>
  images.reduce((acc, image) => acc.split(`cid:${stripBrackets(image.contentId)}`).join(`data:${image.contentType};base64,${image.base64}`), html);

// get-mail-attachment result → the inline image's cid, type and bytes (undefined if any is absent).
export const extractInlineImage = (data: unknown): InlineImage | undefined => {
  if (!isRecord(data)) return undefined;
  const contentId = asString(data['contentId']);
  const contentType = asString(data['contentType']);
  const base64 = asString(data['base64']);
  return contentId === undefined || contentType === undefined || base64 === undefined ? undefined : { contentId, contentType, base64 };
};

// Wrap the reply body (at the {{BODY}} marker) in the user's default font/color, then append the signature.
export const buildDraftTemplate = (signatureHtml: string): string =>
  `<div style="font-family: Aptos, Calibri, sans-serif; font-size: 11pt; color: #000000;">\n{{BODY}}\n</div>\n<br>\n${signatureHtml}\n`;

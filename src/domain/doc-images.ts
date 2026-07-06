import { asString, isRecord } from './graph-envelopes.ts';

// extract-drive-item-images returns `{ count, media: [{ path, contentType, sizeBytes, base64 }] }` —
// the full-resolution originals behind the `[image]` placeholders a markdown conversion leaves
// behind (SPEC §7, Img-B). We keep only what the writer needs: the source path and the bytes.
export type DocImage = { readonly path: string; readonly base64: string };

const isDocImage = (image: DocImage | undefined): image is DocImage => image !== undefined;

const toDocImage = (item: Record<string, unknown>): DocImage | undefined => {
  const path = asString(item['path']);
  const base64 = asString(item['base64']);
  return path === undefined || base64 === undefined ? undefined : { path, base64 };
};

export const extractDocImages = (data: unknown): ReadonlyArray<DocImage> =>
  isRecord(data) && Array.isArray(data['media']) ? data['media'].filter(isRecord).map(toDocImage).filter(isDocImage) : [];

// Fold the source part path (`ppt/media/image3.png`) to one filesystem-safe leaf, mirroring the
// library's own savedTo flattening (`pdf_page2_Im0.png`); collapsing `/` also strips any traversal.
export const flattenDocImagePath = (path: string): string => path.replaceAll('/', '_');

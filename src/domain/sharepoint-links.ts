import { asString, isRecord } from './graph-envelopes.ts';

export type ResolvedLink = { readonly url: string; readonly name: string; readonly webUrl: string; readonly driveId: string; readonly itemId: string };

export type ErroredLink = { readonly url: string; readonly error: string };

export type SharepointLink = ResolvedLink | ErroredLink;

const toLink = (link: Record<string, unknown>): SharepointLink | undefined => {
  const url = asString(link['url']);
  if (url === undefined) return undefined;
  const driveId = asString(link['driveId']);
  const itemId = asString(link['itemId']);
  if (driveId !== undefined && itemId !== undefined) {
    return { url, name: asString(link['name']) ?? '(unnamed)', webUrl: asString(link['webUrl']) ?? url, driveId, itemId };
  }
  return { url, error: asString(link['error']) ?? 'unresolved' };
};

const isLink = (link: SharepointLink | undefined): link is SharepointLink => link !== undefined;

/** extract-sharepoint-links-in-mail envelope: `{ links: [resolved | errored, …] }` — entries without a url are skipped. */
export const extractSharepointLinks = (data: unknown): ReadonlyArray<SharepointLink> => {
  if (!isRecord(data) || !Array.isArray(data['links'])) return [];
  return data['links'].filter(isRecord).map(toLink).filter(isLink);
};

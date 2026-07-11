import { asString, isRecord } from './graph-envelopes.ts';

// The inbox delta watermark (SPEC §1 data/state/, §2 Phases 1+5): the scannedAt instant of the
// last wrapped run. `--scope since-watermark` scans only mail received after it, so a daily
// pre-research run reads each message once instead of re-triaging the whole inbox.
export const WATERMARK_PATH = 'data/state/inbox-watermark.json';

export const renderWatermark = (iso: string): string => `${JSON.stringify({ watermark: iso }, null, 2)}\n`;

export const parseWatermark = (content: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const iso = asString(parsed['watermark']);
  return iso === undefined || Number.isNaN(Date.parse(iso)) ? undefined : iso;
};

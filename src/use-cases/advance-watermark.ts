import { asString, isRecord, parseJson } from '../domain/graph-envelopes.ts';
import { parseRunId } from '../domain/run-id.ts';
import { renderWatermark, WATERMARK_PATH } from '../domain/watermark.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { FileReader } from './ports/file-reader.ts';
import type { FileWriter } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';

export type WatermarkError =
  | { readonly kind: 'invalid-run-id'; readonly message: string }
  | { readonly kind: 'candidates-unreadable'; readonly message: string }
  | { readonly kind: 'write-failed'; readonly message: string };

export type AdvanceWatermark = (rawRunId: string) => Promise<Result<string, WatermarkError>>;

type Deps = { readonly reader: FileReader; readonly writer: FileWriter; readonly logger: Logger };

// Phase 5 (SPEC §2): the wrap advances the inbox watermark to the run's scannedAt — the instant
// its inbox listing was taken — so the next `--scope since-watermark` scan starts exactly there.
// Advancing from candidates.json (not "now") means mail that arrived DURING the run is not skipped.
export const createAdvanceWatermark =
  (deps: Deps): AdvanceWatermark =>
  async (rawRunId) => {
    const runId = parseRunId(rawRunId);
    if (!runId.ok) return err({ kind: 'invalid-run-id', message: runId.error });
    const read = await deps.reader.read(`data/scratch/${runId.value}/candidates.json`);
    if (!read.ok) return err({ kind: 'candidates-unreadable', message: read.error.message });
    const parsed = parseJson(read.value);
    const scannedAt = parsed.ok && isRecord(parsed.value) ? asString(parsed.value['scannedAt']) : undefined;
    if (scannedAt === undefined) return err({ kind: 'candidates-unreadable', message: 'candidates.json has no scannedAt' });
    const written = await deps.writer.write(WATERMARK_PATH, renderWatermark(scannedAt));
    if (!written.ok) return err({ kind: 'write-failed', message: written.error.message });
    deps.logger.info('watermark-advanced', { runId: runId.value, watermark: scannedAt });
    return ok(scannedAt);
  };

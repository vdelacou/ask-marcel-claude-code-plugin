import { findBlockedTerm, NEVER_CAPTURE_PATH, parseNeverCapture } from '../domain/capture-filter.ts';
import { appendToQueue, matchesFilter, parseQueue, serializeCandidate, splitQueue } from '../domain/kb-queue.ts';
import type { DrainFilter, KbCandidate } from '../domain/kb-queue.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';

type ReadDeps = { readonly reader: FileReader; readonly files: FileProbe };

export type CaptureBlocked = { readonly kind: 'blocked-by-never-capture'; readonly term: string };

export type QueueError = WriteError | ReadError | CaptureBlocked;

const queuePath = (runId: RunId): string => `data/scratch/${runId}/kb-queue.jsonl`;

// A missing queue file reads as empty; an existing-but-unreadable one is a real error we never clobber.
const readExisting = async (deps: ReadDeps, path: string): Promise<Result<string, ReadError>> => ((await deps.files.exists(path)) ? deps.reader.read(path) : ok(''));

/** The profile's never-capture terms; a missing or unreadable list blocks nothing (decision 20). */
export const loadNeverCapture = async (deps: ReadDeps): Promise<ReadonlyArray<string>> => {
  if (!(await deps.files.exists(NEVER_CAPTURE_PATH))) return [];
  const content = await deps.reader.read(NEVER_CAPTURE_PATH);
  return content.ok ? parseNeverCapture(content.value) : [];
};

export type AppendKbCandidate = (runId: RunId, candidate: KbCandidate) => Promise<Result<void, QueueError>>;

// The EARLY capture sink: a candidate naming a never-capture term is refused before it is
// queued, so the researcher learns immediately instead of the wrap-up failing later.
export const createAppendKbCandidate =
  (deps: ReadDeps & { readonly writer: FileWriter }): AppendKbCandidate =>
  async (runId, candidate) => {
    const blocked = findBlockedTerm(serializeCandidate(candidate), await loadNeverCapture(deps));
    if (blocked !== undefined) return err({ kind: 'blocked-by-never-capture', term: blocked });
    const path = queuePath(runId);
    const existing = await readExisting(deps, path);
    if (!existing.ok) return err(existing.error);
    return deps.writer.write(path, appendToQueue(existing.value, candidate));
  };

export type PeekKbQueue = (runId: RunId, filter?: DrainFilter) => Promise<Result<ReadonlyArray<KbCandidate>, ReadError>>;

// Peek reads the queue WITHOUT consuming it (unlike drain): the file is left byte-identical, so a wrap-up
// leftover-count or any inspection never destroys what a run still holds. Mirrors deferrals `due` (peek/consume).
export const createPeekKbQueue =
  (deps: ReadDeps): PeekKbQueue =>
  async (runId, filter = {}) => {
    const existing = await readExisting(deps, queuePath(runId));
    if (!existing.ok) return err(existing.error);
    return ok(parseQueue(existing.value).filter((candidate) => matchesFilter(candidate, filter)));
  };

export type DrainKbQueue = (runId: RunId, filter?: DrainFilter) => Promise<Result<ReadonlyArray<KbCandidate>, QueueError>>;

// A drain CONSUMES what it returns (SPEC §2 step 9): the matching candidates are removed from
// the queue file, so per-email capture never re-lands another email's facts and the jargon
// wrap-up starts from exactly what research left behind. The remainder is written before the
// batch is returned; a failed rewrite fails the drain and leaves the queue file untouched.
export const createDrainKbQueue =
  (deps: ReadDeps & { readonly writer: FileWriter }): DrainKbQueue =>
  async (runId, filter = {}) => {
    const path = queuePath(runId);
    const existing = await readExisting(deps, path);
    if (!existing.ok) return err(existing.error);
    const { drained, remaining } = splitQueue(existing.value, filter);
    if (drained.length === 0) return ok([]);
    const written = await deps.writer.write(path, remaining);
    return written.ok ? ok(drained) : err(written.error);
  };

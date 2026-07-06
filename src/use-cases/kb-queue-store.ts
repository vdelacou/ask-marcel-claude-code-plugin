import { appendToQueue, parseQueue } from '../domain/kb-queue.ts';
import type { KbCandidate } from '../domain/kb-queue.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunId } from '../domain/run-id.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileReader, ReadError } from './ports/file-reader.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';

type ReadDeps = { readonly reader: FileReader; readonly files: FileProbe };

export type QueueError = WriteError | ReadError;

const queuePath = (runId: RunId): string => `data/scratch/${runId}/kb-queue.jsonl`;

// A missing queue file reads as empty; an existing-but-unreadable one is a real error we never clobber.
const readExisting = async (deps: ReadDeps, path: string): Promise<Result<string, ReadError>> => ((await deps.files.exists(path)) ? deps.reader.read(path) : ok(''));

export type AppendKbCandidate = (runId: RunId, candidate: KbCandidate) => Promise<Result<void, QueueError>>;

export const createAppendKbCandidate =
  (deps: ReadDeps & { readonly writer: FileWriter }): AppendKbCandidate =>
  async (runId, candidate) => {
    const path = queuePath(runId);
    const existing = await readExisting(deps, path);
    if (!existing.ok) return err(existing.error);
    return deps.writer.write(path, appendToQueue(existing.value, candidate));
  };

export type DrainKbQueue = (runId: RunId) => Promise<Result<ReadonlyArray<KbCandidate>, ReadError>>;

export const createDrainKbQueue =
  (deps: ReadDeps): DrainKbQueue =>
  async (runId) => {
    const existing = await readExisting(deps, queuePath(runId));
    return existing.ok ? ok(parseQueue(existing.value)) : err(existing.error);
  };

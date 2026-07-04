import type { RunState } from '../domain/email-state.ts';
import { extractMessages, parseEnvelope } from '../domain/graph-envelopes.ts';
import { parseRunId } from '../domain/run-id.ts';
import type { RunId } from '../domain/run-id.ts';
import { err, ok, unwrap } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { evaluateMessage } from '../domain/triage-rules.ts';
import type { DropReason, InboxMessage } from '../domain/triage-rules.ts';
import type { Clock } from './ports/clock.ts';
import type { CommandRunner } from './ports/command-runner.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { Logger } from './ports/logger.ts';
import type { StateStore } from './ports/state-store.ts';

export type ScanScope = 'unread' | 'all';

export type ScanOptions = { readonly scope: ScanScope; readonly cap: number; readonly blocked: ReadonlyArray<string> };

export type ScanError =
  { readonly kind: 'source-failed'; readonly source: 'list-inbox'; readonly message: string } | { readonly kind: 'state-save-failed'; readonly message: string } | WriteError;

export type DroppedMessage = { readonly id: string; readonly subject: string; readonly from: string; readonly reason: DropReason };

export type ScanSummary = { readonly runId: string; readonly kept: ReadonlyArray<InboxMessage>; readonly dropped: ReadonlyArray<DroppedMessage> };

export type ScanInbox = (options: ScanOptions) => Promise<Result<ScanSummary, ScanError>>;

type Deps = {
  readonly runner: CommandRunner;
  readonly writer: FileWriter;
  readonly stateStore: StateStore;
  readonly clock: Clock;
  readonly logger: Logger;
};

const SELECT_FIELDS = 'id,conversationId,subject,from,receivedDateTime,hasAttachments,importance,bodyPreview';

// A valid ISO instant always yields a well-formed RunId, so unwrap is a programmer-bug guard, not a flow.
const runIdFrom = (nowIso: string): RunId => unwrap(parseRunId(`run-${nowIso.slice(0, 10).replaceAll('-', '')}-${nowIso.slice(11, 19).replaceAll(':', '')}`));

const listArgs = (options: ScanOptions): ReadonlyArray<string> => [
  'list-mail-folder-messages',
  '--mail-folder-id',
  'inbox',
  '--top',
  String(options.cap),
  ...(options.scope === 'unread' ? ['--filter', 'isRead eq false'] : []),
  '--select',
  SELECT_FIELDS,
  '--output',
  'json',
];

const fetchInbox = async (deps: Deps, options: ScanOptions): Promise<Result<ReadonlyArray<InboxMessage>, ScanError>> => {
  const run = await deps.runner.run('ask-marcel-office', listArgs(options));
  if (!run.ok) return err({ kind: 'source-failed', source: 'list-inbox', message: run.error.message });
  if (run.value.exitCode !== 0) return err({ kind: 'source-failed', source: 'list-inbox', message: `exited ${run.value.exitCode}` });
  const parsed = parseEnvelope(run.value.stdout);
  if (!parsed.ok) return err({ kind: 'source-failed', source: 'list-inbox', message: parsed.error });
  return ok(extractMessages(parsed.value));
};

const split = (messages: ReadonlyArray<InboxMessage>, blocked: ReadonlyArray<string>): { readonly kept: InboxMessage[]; readonly dropped: DroppedMessage[] } => {
  const kept: InboxMessage[] = [];
  const dropped: DroppedMessage[] = [];
  for (const message of messages) {
    const decision = evaluateMessage(message, blocked);
    if (decision.keep) kept.push(message);
    else dropped.push({ id: message.id, subject: message.subject, from: message.fromAddress, reason: decision.reason });
  }
  return { kept, dropped };
};

export const createScanInbox =
  (deps: Deps): ScanInbox =>
  async (options) => {
    const messages = await fetchInbox(deps, options);
    if (!messages.ok) return err(messages.error);
    const { kept, dropped } = split(messages.value, options.blocked);
    const nowIso = deps.clock.nowIso();
    const runId = runIdFrom(nowIso);
    const state: RunState = Object.fromEntries(kept.map((message) => [message.id, 'scanned']));
    const saved = await deps.stateStore.save(runId, state);
    if (!saved.ok) return err({ kind: 'state-save-failed', message: saved.error.message });
    const candidates = { runId: runId as string, scannedAt: nowIso, scope: options.scope, kept, dropped };
    const written = await deps.writer.write(`data/scratch/${runId}/candidates.json`, JSON.stringify(candidates, null, 2));
    if (!written.ok) return err(written.error);
    deps.logger.info('inbox-scanned', { runId, kept: kept.length, dropped: dropped.length });
    return ok({ runId, kept, dropped });
  };

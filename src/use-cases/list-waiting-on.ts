import { asString, isRecord } from '../domain/graph-envelopes.ts';
import { waitingThreads } from '../domain/waiting-on.ts';
import type { WaitingThread } from '../domain/waiting-on.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Clock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { Office } from './ports/office.ts';

export type WaitingOnOptions = { readonly minAgeDays: number; readonly fetchTop: number };

export type WaitingOnError = { readonly kind: 'source-failed'; readonly source: 'me' | 'mailbox'; readonly message: string };

export type ListWaitingOn = (options: WaitingOnOptions) => Promise<Result<ReadonlyArray<WaitingThread>, WaitingOnError>>;

type Deps = { readonly office: Office; readonly clock: Clock; readonly logger: Logger };

const SELECT_FIELDS = 'id,conversationId,subject,from,toRecipients,receivedDateTime';

// One page over the WHOLE mailbox (every folder, newest first) so a conversation's true latest
// message is seen wherever it was filed; the user's address comes from Graph, not a config that
// can drift. Read-only - the nudge itself stays the user's decision.
export const createListWaitingOn =
  (deps: Deps): ListWaitingOn =>
  async (options) => {
    const who = await deps.office.execute('get-current-user', { select: 'mail,userPrincipalName' });
    if (!who.ok) return err({ kind: 'source-failed', source: 'me', message: who.error.message });
    const meAddress = isRecord(who.value) ? (asString(who.value['mail']) ?? asString(who.value['userPrincipalName'])) : undefined;
    if (meAddress === undefined) return err({ kind: 'source-failed', source: 'me', message: 'get-current-user returned no address' });
    const page = await deps.office.execute('list-mail-messages', { top: String(options.fetchTop), orderby: 'receivedDateTime desc', select: SELECT_FIELDS });
    if (!page.ok) return err({ kind: 'source-failed', source: 'mailbox', message: page.error.message });
    const waiting = waitingThreads(page.value, meAddress, deps.clock.todayIso(), options.minAgeDays);
    deps.logger.info('waiting-on-listed', { threads: waiting.length, minAgeDays: options.minAgeDays });
    return ok(waiting);
  };

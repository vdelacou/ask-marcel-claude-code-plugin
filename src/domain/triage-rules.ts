export type InboxMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly subject: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly importance: string;
  readonly bodyPreview: string;
};

export type DropReason = 'no-reply-sender' | 'calendar-response' | 'blocked-sender';

export type TriageDecision = { readonly keep: true } | { readonly keep: false; readonly reason: DropReason };

const NO_REPLY_PREFIXES = ['no-reply', 'noreply', 'do-not-reply', 'donotreply', 'notification', 'notifications', 'mailer-daemon', 'postmaster', 'newsletter'];

// Outlook reply-to-invitation subjects, English and French tenants alike.
const CALENDAR_PREFIXES = ['accepted:', 'declined:', 'tentative:', 'canceled:', 'cancelled:', 'accepté', 'refusé', 'provisoire', 'annulé'];

const localPart = (address: string): string => address.toLowerCase().split('@')[0] ?? '';

const senderDomain = (address: string): string => address.toLowerCase().split('@')[1] ?? '';

const isNoReply = (address: string): boolean => NO_REPLY_PREFIXES.some((prefix) => localPart(address).startsWith(prefix));

const isCalendarResponse = (subject: string): boolean => CALENDAR_PREFIXES.some((prefix) => subject.toLowerCase().startsWith(prefix));

const isBlocked = (address: string, blocked: ReadonlyArray<string>): boolean =>
  blocked.some((entry) => entry.toLowerCase() === address.toLowerCase() || entry.toLowerCase() === senderDomain(address));

export const evaluateMessage = (message: InboxMessage, blocked: ReadonlyArray<string>): TriageDecision => {
  if (isNoReply(message.fromAddress)) return { keep: false, reason: 'no-reply-sender' };
  if (isCalendarResponse(message.subject)) return { keep: false, reason: 'calendar-response' };
  if (isBlocked(message.fromAddress, blocked)) return { keep: false, reason: 'blocked-sender' };
  return { keep: true };
};

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
  readonly odataType: string;
};

export type DropReason = 'no-reply-sender' | 'calendar-response' | 'blocked-sender';

export type TriageDecision = { readonly keep: true } | { readonly keep: false; readonly reason: DropReason };

const NO_REPLY_PREFIXES = ['no-reply', 'noreply', 'do-not-reply', 'donotreply', 'notification', 'notifications', 'mailer-daemon', 'postmaster', 'newsletter'];

// Primary, language-independent signal: Graph types accept/decline/tentative
// replies as eventMessageResponse (SPEC.md decision 23). Invites
// (eventMessageRequest) are NOT dropped - a scout may still judge them.
const CALENDAR_RESPONSE_TYPE = '#microsoft.graph.eventMessageResponse';

// Fallback for clients that strip the odata type: localized Outlook
// reply-to-invitation subject prefixes (EN, FR, ZH, DE, ES, IT, PT).
const CALENDAR_PREFIXES = [
  'accepted:',
  'declined:',
  'tentative:',
  'canceled:',
  'cancelled:',
  'accepté',
  'refusé',
  'provisoire',
  'annulé',
  '已接受',
  '已拒绝',
  '暂定',
  '已取消',
  'zugesagt:',
  'abgelehnt:',
  'mit vorbehalt',
  'abgesagt:',
  'aceptado:',
  'rechazado:',
  'provisional:',
  'cancelado:',
  'accettato:',
  'rifiutato:',
  'provvisorio:',
  'annullato:',
  'aceito:',
  'aceite:',
  'recusado:',
  'provisório:',
];

const localPart = (address: string): string => address.toLowerCase().split('@')[0] ?? '';

const senderDomain = (address: string): string => address.toLowerCase().split('@')[1] ?? '';

const isNoReply = (address: string): boolean => NO_REPLY_PREFIXES.some((prefix) => localPart(address).startsWith(prefix));

const isCalendarResponse = (subject: string): boolean => CALENDAR_PREFIXES.some((prefix) => subject.toLowerCase().startsWith(prefix));

const isBlocked = (address: string, blocked: ReadonlyArray<string>): boolean =>
  blocked.some((entry) => entry.toLowerCase() === address.toLowerCase() || entry.toLowerCase() === senderDomain(address));

export const evaluateMessage = (message: InboxMessage, blocked: ReadonlyArray<string>): TriageDecision => {
  if (isNoReply(message.fromAddress)) return { keep: false, reason: 'no-reply-sender' };
  if (message.odataType === CALENDAR_RESPONSE_TYPE) return { keep: false, reason: 'calendar-response' };
  if (isCalendarResponse(message.subject)) return { keep: false, reason: 'calendar-response' };
  if (isBlocked(message.fromAddress, blocked)) return { keep: false, reason: 'blocked-sender' };
  return { keep: true };
};

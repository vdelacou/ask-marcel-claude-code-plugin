import { describe, expect, test } from 'bun:test';

import { evaluateMessage } from './triage-rules.ts';
import type { InboxMessage } from './triage-rules.ts';

const message = (overrides: Partial<InboxMessage>): InboxMessage => ({
  id: 'm1',
  conversationId: 'c1',
  subject: 'Budget question',
  fromName: 'Jane Boss',
  fromAddress: 'jane@internal-corp.com',
  receivedDateTime: '2026-07-04T08:00:00Z',
  hasAttachments: false,
  importance: 'normal',
  bodyPreview: '',
  ...overrides,
});

describe('triage rules', () => {
  test('no-reply and notification senders are dropped by rule and reported, never silently', () => {
    const prefixes = ['no-reply', 'noreply', 'do-not-reply', 'donotreply', 'notification', 'notifications', 'mailer-daemon', 'postmaster', 'newsletter'];
    for (const prefix of prefixes) {
      expect(evaluateMessage(message({ fromAddress: `${prefix}@service.com` }), [])).toEqual({ keep: false, reason: 'no-reply-sender' });
    }
    expect(evaluateMessage(message({ fromAddress: 'No-Reply@service.com' }), [])).toEqual({ keep: false, reason: 'no-reply-sender' });
    expect(evaluateMessage(message({}), [])).toEqual({ keep: true });
  });

  test('calendar responses are dropped, English and French alike', () => {
    const prefixes = ['Accepted:', 'Declined:', 'Tentative:', 'Canceled:', 'Cancelled:', 'Accepté:', 'Refusé:', 'Provisoire:', 'Annulé:'];
    for (const prefix of prefixes) {
      expect(evaluateMessage(message({ subject: `${prefix} Budget review` }), [])).toEqual({ keep: false, reason: 'calendar-response' });
    }
    expect(evaluateMessage(message({ subject: 'RE: Accepted terms attached' }), [])).toEqual({ keep: true });
  });

  test('blocked senders are dropped whether matched by domain or full address', () => {
    const blocked = ['spam-corp.com', 'vip@ok.com'];

    expect(evaluateMessage(message({ fromAddress: 'anyone@spam-corp.com' }), blocked)).toEqual({ keep: false, reason: 'blocked-sender' });
    expect(evaluateMessage(message({ fromAddress: 'VIP@ok.com' }), blocked)).toEqual({ keep: false, reason: 'blocked-sender' });
    expect(evaluateMessage(message({ fromAddress: 'other@ok.com' }), blocked)).toEqual({ keep: true });
  });
});

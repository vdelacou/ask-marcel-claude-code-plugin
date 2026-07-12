import { describe, expect, test } from 'bun:test';

import { waitingThreads } from './waiting-on.ts';

const TODAY = '2026-07-13';
const ME = 'Me@Internal-Corp.com';

const message = (conversationId: string, from: string, receivedDateTime: string, subject = 'RE: topic', to: ReadonlyArray<string> = ['Jane Boss']): Record<string, unknown> => ({
  conversationId,
  subject,
  from: { emailAddress: { address: from } },
  toRecipients: to.map((name) => ({ emailAddress: { name, address: `${name.replaceAll(' ', '.')}@internal-corp.com` } })),
  receivedDateTime,
});

describe('waitingThreads', () => {
  test('a thread whose last word is mine and old enough is waiting; an answered thread is not', () => {
    const payload = {
      value: [
        // newest-first page, as the caller orders it
        message('conv-answered', 'jane@internal-corp.com', '2026-07-12T09:00:00Z'),
        message('conv-answered', 'me@internal-corp.com', '2026-07-08T09:00:00Z'),
        message('conv-waiting', 'me@internal-corp.com', '2026-07-09T10:00:00Z', 'Vendor contract', ['Ext Vendor']),
        message('conv-waiting', 'vendor@ext-corp.com', '2026-07-07T10:00:00Z'),
      ],
    };

    expect(waitingThreads(payload, ME, TODAY, 3)).toEqual([
      { conversationId: 'conv-waiting', subject: 'Vendor contract', to: ['Ext Vendor'], lastSentAt: '2026-07-09T10:00:00Z', ageDays: 3 },
    ]);
  });

  test('the age threshold is inclusive at exactly minAgeDays and case-insensitive on my address', () => {
    const twoDays = { value: [message('conv-young', 'ME@INTERNAL-CORP.COM', '2026-07-11T00:00:00Z')] };
    expect(waitingThreads(twoDays, ME, TODAY, 3)).toEqual([]);
    expect(waitingThreads(twoDays, ME, TODAY, 2)).toHaveLength(1);
  });

  test('the oldest silence sorts first, and recipient names fall back to addresses', () => {
    const payload = {
      value: [
        message('conv-a', 'me@internal-corp.com', '2026-07-09T00:00:00Z'),
        {
          conversationId: 'conv-b',
          subject: 'Old ask',
          from: { emailAddress: { address: 'me@internal-corp.com' } },
          toRecipients: [{ emailAddress: { address: 'bare@x.com' } }],
          receivedDateTime: '2026-07-01T00:00:00Z',
        },
      ],
    };

    const waiting = waitingThreads(payload, ME, TODAY, 3);

    expect(waiting.map((thread) => thread.conversationId)).toEqual(['conv-b', 'conv-a']);
    expect(waiting[0]?.to).toEqual(['bare@x.com']);
  });

  test('shapeless messages and a shapeless payload contribute nothing, never a crash', () => {
    expect(waitingThreads('garbage', ME, TODAY, 3)).toEqual([]);
    expect(waitingThreads({ value: 'not an array' }, ME, TODAY, 3)).toEqual([]);
    expect(waitingThreads({ value: ['nope', { conversationId: 'c' }] }, ME, TODAY, 3)).toEqual([]);
  });

  test('each identity field is required on its own, and a garbage date never becomes a waiting thread', () => {
    const base = { subject: 's', from: { emailAddress: { address: 'me@internal-corp.com' } }, receivedDateTime: '2026-07-01T00:00:00Z' };
    expect(waitingThreads({ value: [{ ...base }] }, ME, TODAY, 3)).toEqual([]); // no conversationId
    expect(waitingThreads({ value: [{ ...base, conversationId: 'c', receivedDateTime: undefined }] }, ME, TODAY, 3)).toEqual([]);
    expect(waitingThreads({ value: [{ ...base, conversationId: 'c', from: {} }] }, ME, TODAY, 3)).toEqual([]);
    expect(waitingThreads({ value: [{ ...base, conversationId: 'c', receivedDateTime: 'not-a-date' }] }, ME, TODAY, 3)).toEqual([]);
  });

  test('recipient intake tolerates garbage entries and a missing subject gains the default', () => {
    const waiting = waitingThreads(
      {
        value: [
          {
            conversationId: 'c',
            from: { emailAddress: { address: 'me@internal-corp.com' } },
            receivedDateTime: '2026-07-01T00:00:00Z',
            toRecipients: ['garbage', { emailAddress: 'nope' }, { emailAddress: {} }, { emailAddress: { name: 'Jane Boss' } }],
          },
          { conversationId: 'c2', from: { emailAddress: { address: 'me@internal-corp.com' } }, receivedDateTime: '2026-07-02T00:00:00Z', toRecipients: 'nobody' },
        ],
      },
      ME,
      TODAY,
      3
    );

    expect(waiting).toHaveLength(2);
    expect(waiting[0]).toMatchObject({ conversationId: 'c', subject: '(no subject)', to: ['Jane Boss'] });
    expect(waiting[1]?.to).toEqual([]);
  });
});

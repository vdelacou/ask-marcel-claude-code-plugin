import { describe, expect, test } from 'bun:test';

import { extractCurrentUser, extractManager, extractMessages, extractRelevantPeople, extractSentMetas, extractUsers, parseEnvelope, parseJson } from './graph-envelopes.ts';
import { unwrap } from './result.ts';

const envelope = (data: unknown): string => JSON.stringify({ ok: true, data });

describe('graph envelopes', () => {
  test('the current-user envelope yields identity and internal domain', () => {
    const data = unwrap(
      parseEnvelope(
        envelope({
          '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#users/$entity',
          displayName: 'Test User',
          mail: 'Me@Internal-Corp.com',
          userPrincipalName: 'test.user@internal-corp.onmicrosoft.com',
          jobTitle: 'Director',
        })
      )
    );

    expect(extractCurrentUser(data)).toEqual({ ok: true, value: { displayName: 'Test User', email: 'me@internal-corp.com', domain: 'internal-corp.com' } });

    const upnOnly = unwrap(parseEnvelope(envelope({ displayName: 'Test User', userPrincipalName: 'Me@Internal-Corp.com' })));
    expect(extractCurrentUser(upnOnly)).toEqual({ ok: true, value: { displayName: 'Test User', email: 'me@internal-corp.com', domain: 'internal-corp.com' } });

    const emptyMail = unwrap(parseEnvelope(envelope({ displayName: 'Test User', mail: '', userPrincipalName: 'me@internal-corp.com' })));
    expect(extractCurrentUser(emptyMail)).toEqual({ ok: true, value: { displayName: 'Test User', email: 'me@internal-corp.com', domain: 'internal-corp.com' } });
  });

  test('user lists and relevant people flatten to person seeds, entries without an email are skipped', () => {
    const reports = unwrap(
      parseEnvelope(
        envelope({
          value: [
            {
              '@odata.type': '#microsoft.graph.user',
              displayName: 'Report One',
              mail: 'Report.One@internal-corp.com',
              userPrincipalName: 'r.one@internal-corp.onmicrosoft.com',
              jobTitle: 'Manager',
              department: 'Ops',
              givenName: 'Report',
              surname: 'One',
            },
            { displayName: 'No Mail Person' },
            { mail: 'ghost@x.com' },
            { displayName: 'UPN Only', userPrincipalName: 'UPN.Only@Internal-Corp.com' },
          ],
        })
      )
    );
    const relevant = unwrap(
      parseEnvelope(
        envelope({
          value: [
            {
              displayName: 'Jane Boss',
              scoredEmailAddresses: [{ address: 'Jane@Internal-Corp.com', relevanceScore: 20 }, { address: 'jane.boss@partner.com' }],
              jobTitle: 'VP',
              companyName: 'Internal Corp',
              department: 'Direction',
            },
            { displayName: 'No Address Person', scoredEmailAddresses: [] },
          ],
        })
      )
    );

    expect(extractUsers(reports)).toHaveLength(2);
    expect(extractUsers(reports)).toEqual([
      { displayName: 'Report One', emails: ['report.one@internal-corp.com'], title: 'Manager', department: 'Ops' },
      { displayName: 'UPN Only', emails: ['upn.only@internal-corp.com'], title: undefined, department: undefined },
    ]);
    expect(extractRelevantPeople(relevant)).toHaveLength(1);
    expect(extractRelevantPeople(relevant)).toEqual([
      { displayName: 'Jane Boss', emails: ['jane@internal-corp.com', 'jane.boss@partner.com'], title: 'VP', company: 'Internal Corp', department: 'Direction' },
    ]);
  });

  test('a directory without a manager yields no seed, a set manager yields one', () => {
    const noManager = unwrap(parseEnvelope(envelope({ manager: null, note: 'signed-in user has no manager set in the directory' })));
    const withManager = unwrap(parseEnvelope(envelope({ manager: { displayName: 'Jane Boss', mail: 'jane@internal-corp.com', jobTitle: 'VP' } })));

    expect(extractManager(noManager)).toBeUndefined();
    expect(extractManager(withManager)).toEqual({ displayName: 'Jane Boss', emails: ['jane@internal-corp.com'], title: 'VP', department: undefined });
  });

  test('inbox message envelopes flatten with sender identity, malformed entries skipped', () => {
    const data = unwrap(
      parseEnvelope(
        envelope({
          value: [
            {
              id: 'm1',
              conversationId: 'c1',
              subject: 'Budget',
              from: { emailAddress: { name: 'Jane Boss', address: 'Jane@Internal-Corp.com' } },
              receivedDateTime: '2026-07-04T08:00:00Z',
              hasAttachments: true,
              importance: 'high',
              bodyPreview: 'Please review',
            },
            { id: 'm2', subject: 'malformed, no sender' },
          ],
        })
      )
    );

    expect(extractMessages(data)).toEqual([
      {
        id: 'm1',
        conversationId: 'c1',
        subject: 'Budget',
        fromName: 'Jane Boss',
        fromAddress: 'jane@internal-corp.com',
        receivedDateTime: '2026-07-04T08:00:00Z',
        hasAttachments: true,
        importance: 'high',
        bodyPreview: 'Please review',
        odataType: '',
      },
    ]);
    const typed = unwrap(
      parseEnvelope(
        envelope({ value: [{ '@odata.type': '#microsoft.graph.eventMessageResponse', id: 'm9', conversationId: 'c9', from: { emailAddress: { address: 'a@x.com' } } }] })
      )
    );
    expect(extractMessages(typed)[0].odataType).toBe('#microsoft.graph.eventMessageResponse');

    const minimal = unwrap(parseEnvelope(envelope({ value: [{ id: 'm3', conversationId: 'c3', subject: 42, from: { emailAddress: { address: 'Bare@x.com' } } }] })));
    expect(extractMessages(minimal)).toEqual([
      {
        id: 'm3',
        conversationId: 'c3',
        subject: '(no subject)',
        fromName: 'bare@x.com',
        fromAddress: 'bare@x.com',
        receivedDateTime: '',
        hasAttachments: false,
        importance: 'normal',
        bodyPreview: '',
        odataType: '',
      },
    ]);
    expect(extractMessages({ value: 'nope' })).toEqual([]);

    const sent = unwrap(
      parseEnvelope(
        envelope({
          value: [
            {
              id: 's1',
              subject: 'Budget',
              receivedDateTime: '2026-07-01T08:00:00Z',
              isDraft: true,
              toRecipients: [{ emailAddress: { address: 'Jane@Internal-Corp.com' } }, { bad: true }, { emailAddress: { address: '' } }],
              ccRecipients: 'nope',
            },
            { subject: 'no id, skipped' },
            { id: 's2' },
          ],
        })
      )
    );
    expect(extractSentMetas(sent)).toHaveLength(2);
    expect(extractSentMetas(sent)[0].to).toHaveLength(1);
    expect(extractSentMetas(sent)).toEqual([
      { id: 's1', subject: 'Budget', sentAt: '2026-07-01T08:00:00Z', to: ['jane@internal-corp.com'], cc: [], isDraft: true },
      { id: 's2', subject: '(no subject)', sentAt: '', to: [], cc: [], isDraft: false },
    ]);
    expect(extractSentMetas(null)).toEqual([]);
    expect(extractSentMetas({ value: 'nope' })).toEqual([]);
  });

  test('garbage json and wrong shapes yield errors, never throws', () => {
    expect(parseEnvelope('not json at all')).toEqual({ ok: false, error: 'invalid json' });
    expect(parseEnvelope(JSON.stringify({ ok: false, error: 'boom' }))).toEqual({ ok: false, error: 'envelope is not ok' });
    expect(extractCurrentUser(42)).toEqual({ ok: false, error: 'current-user: unexpected shape' });
    expect(extractCurrentUser({ displayName: 'X' })).toEqual({ ok: false, error: 'current-user: missing displayName or mail' });
    expect(extractCurrentUser({ mail: 'x@y.com' })).toEqual({ ok: false, error: 'current-user: missing displayName or mail' });
    expect(extractUsers(null)).toEqual([]);
    expect(extractRelevantPeople({ value: 'nope' })).toEqual([]);
    expect(extractManager('nope')).toBeUndefined();
  });

  test('parseJson returns the bare parsed value, or a typed error on malformed input', () => {
    expect(parseJson('[{"a":1}]')).toEqual({ ok: true, value: [{ a: 1 }] });
    expect(parseJson('not json')).toEqual({ ok: false, error: 'invalid json' });
  });
});

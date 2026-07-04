import { describe, expect, test } from 'bun:test';

import { extractCurrentUser, extractManager, extractRelevantPeople, extractUsers, parseEnvelope } from './graph-envelopes.ts';
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
          userPrincipalName: 'me@internal-corp.com',
          jobTitle: 'Director',
        })
      )
    );

    expect(extractCurrentUser(data)).toEqual({ ok: true, value: { displayName: 'Test User', email: 'me@internal-corp.com', domain: 'internal-corp.com' } });
  });

  test('user lists and relevant people flatten to person seeds, entries without an email are skipped', () => {
    const reports = unwrap(
      parseEnvelope(
        envelope({
          value: [
            { '@odata.type': '#microsoft.graph.user', displayName: 'Report One', mail: 'Report.One@internal-corp.com', jobTitle: 'Manager', givenName: 'Report', surname: 'One' },
            { displayName: 'No Mail Person' },
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

    expect(extractUsers(reports)).toEqual([{ displayName: 'Report One', emails: ['report.one@internal-corp.com'], title: 'Manager', department: undefined }]);
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

  test('garbage json and wrong shapes yield errors, never throws', () => {
    expect(parseEnvelope('not json at all')).toEqual({ ok: false, error: 'invalid json' });
    expect(parseEnvelope(JSON.stringify({ ok: false, error: 'boom' }))).toEqual({ ok: false, error: 'envelope is not ok' });
    expect(extractCurrentUser(42)).toEqual({ ok: false, error: 'current-user: unexpected shape' });
    expect(extractCurrentUser({ displayName: 'X' })).toEqual({ ok: false, error: 'current-user: missing displayName or mail' });
    expect(extractUsers(null)).toEqual([]);
    expect(extractRelevantPeople({ value: 'nope' })).toEqual([]);
    expect(extractManager('nope')).toBeUndefined();
  });
});

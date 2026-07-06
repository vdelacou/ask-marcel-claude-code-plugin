import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import type { OfficeError } from './ports/office.ts';
import { createSeedKb } from './seed-kb.ts';
import type { SeedKb } from './seed-kb.ts';

type OfficeResp = Result<unknown, OfficeError>;
type Responses = Readonly<Record<string, OfficeResp>>;

// The library returns each command's data object directly, keyed here by command name.
const SOURCES: Responses = {
  'get-current-user': ok({ displayName: 'Test User', mail: 'me@internal-corp.com', userPrincipalName: 'me@internal-corp.com', jobTitle: 'Director' }),
  'get-my-manager': ok({ manager: null, note: 'signed-in user has no manager set in the directory' }),
  'list-my-direct-reports': ok({ value: [{ displayName: 'Report One', mail: 'report.one@internal-corp.com', jobTitle: 'Manager' }] }),
  'list-relevant-people': ok({ value: [{ displayName: 'Ext Vendor', scoredEmailAddresses: [{ address: 'vendor@ext-corp.com' }], jobTitle: 'Sales', companyName: 'Ext Corp' }] }),
};

const SEEDED_LOG = '# Log\n\n## 2026-07-04\n\n- kb-init: created the OKF skeleton\n';

type Written = { readonly path: string; readonly content: string };
type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

type Setup = { readonly seedKb: SeedKb; readonly written: ReadonlyArray<Written>; readonly officeLog: ReadonlyArray<OfficeCall>; readonly logger: LoggerFake };

const setup = (overrides: Responses = {}, existingPages: ReadonlyArray<string> = [], failWrite?: WriteError): Setup => {
  const responses = { ...SOURCES, ...overrides };
  const written: Written[] = [];
  const officeLog: OfficeCall[] = [];
  const logger = createLoggerFake();
  const writer: FileWriter = {
    write: async (path, content) => {
      if (failWrite !== undefined && failWrite.path === path) return err(failWrite);
      written.push({ path, content });
      return ok(undefined);
    },
  };
  const seedKb = createSeedKb({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        return responses[command] ?? err({ kind: 'unknown-command', message: `${command}: not registered` });
      },
    },
    files: { exists: async (path) => path === 'data/kb/index.md' || existingPages.includes(path) },
    reader: { read: async (path) => (path === 'data/kb/log.md' ? ok(SEEDED_LOG) : err({ kind: 'read-failed', path, message: 'missing' })) },
    writer,
    clock: { todayIso: () => '2026-07-04', nowIso: () => '2026-07-04T00:00:00.000Z' },
    logger,
  });
  return { seedKb, written, officeLog, logger };
};

const OPTIONS = { relevantTop: 15, pageCap: 40 };

describe('seed-kb', () => {
  test('a user without a manager in the directory seeds cleanly', async () => {
    const { seedKb, written, officeLog, logger } = setup();

    const result = await seedKb(OPTIONS);

    expect(result).toEqual({
      ok: true,
      value: {
        created: ['data/kb/orgs/ext-corp-com.md', 'data/kb/orgs/internal-corp-com.md', 'data/kb/people/report-one.md', 'data/kb/people/ext-vendor.md'],
        skipped: [],
        dropped: 0,
      },
    });
    // relevant-people is fetched with the configured cap, and the run is logged
    expect(officeLog).toContainEqual({ command: 'list-relevant-people', params: { top: '15' } });
    expect(logger.calls).toEqual([{ level: 'info', event: 'kb-seeded', meta: { created: 4, skipped: 0, dropped: 0 } }]);
    // each org page carries its email domain in the frontmatter
    expect(written.find((w) => w.path === 'data/kb/orgs/internal-corp-com.md')?.content).toContain('relationship: internal');
    expect(written.find((w) => w.path === 'data/kb/orgs/internal-corp-com.md')?.content).toContain('internal-corp.com');
    expect(written.find((w) => w.path === 'data/kb/orgs/ext-corp-com.md')?.content).toContain('relationship: external');
  });

  test('a current user that cannot be resolved aborts the seed as source-failed', async () => {
    const { seedKb } = setup({ 'get-current-user': ok({ mail: 'me@internal-corp.com' }) });

    expect(await seedKb(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'get-current-user', message: 'current-user: missing displayName or mail' } });
  });

  test('the same human via two sources gets one page', async () => {
    const { seedKb } = setup({
      'get-my-manager': ok({ manager: { displayName: 'Jane Boss', mail: 'jane@internal-corp.com', jobTitle: 'VP' } }),
      'list-relevant-people': ok({
        value: [
          {
            displayName: 'Jane Boss',
            scoredEmailAddresses: [{ address: 'JANE@internal-corp.com' }, { address: 'jane.boss@partner.com' }],
            jobTitle: 'VP',
            companyName: 'Internal Corp',
          },
        ],
      }),
    });

    const result = await seedKb(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.created.filter((path) => path === 'data/kb/people/jane-boss.md')).toEqual(['data/kb/people/jane-boss.md']);
  });

  test('existing pages are never overwritten by seeding', async () => {
    const { seedKb, written } = setup({}, ['data/kb/people/report-one.md']);

    const result = await seedKb(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.skipped).toEqual(['data/kb/people/report-one.md']);
    expect(written.some((w) => w.path === 'data/kb/people/report-one.md')).toBe(false);
  });

  test('every seeded page lands in log.md under today', async () => {
    const { seedKb, written } = setup();

    await seedKb(OPTIONS);

    const log = written.find((w) => w.path === 'data/kb/log.md');
    expect(log?.content).toBe(
      '# Log\n\n## 2026-07-04\n\n- kb-seed: orgs/ext-corp-com.md\n- kb-seed: orgs/internal-corp-com.md\n- kb-seed: people/report-one.md\n- kb-seed: people/ext-vendor.md\n- kb-init: created the OKF skeleton\n'
    );
  });

  test('malformed source data yields no seeds from that source, not a crash', async () => {
    const { seedKb } = setup({ 'list-relevant-people': ok('segfault haha') });

    const result = await seedKb(OPTIONS);

    if (!result.ok) throw new Error('expected ok');
    // the relevant-people source contributed nothing, so its vendor + org never appear
    expect(result.value.created).toEqual(['data/kb/orgs/internal-corp-com.md', 'data/kb/people/report-one.md']);
  });

  test('the seed respects the page cap and reports what it dropped', async () => {
    const { seedKb } = setup();

    const result = await seedKb({ relevantTop: 15, pageCap: 3 });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.created).toEqual(['data/kb/orgs/ext-corp-com.md', 'data/kb/orgs/internal-corp-com.md', 'data/kb/people/report-one.md']);
    expect(result.value.dropped).toBe(1);
  });

  test('a page write failure aborts the seed naming the failing path', async () => {
    const { seedKb } = setup({}, [], { kind: 'write-failed', path: 'data/kb/orgs/ext-corp-com.md', message: 'disk full' });

    expect(await seedKb(OPTIONS)).toEqual({ ok: false, error: { kind: 'write-failed', path: 'data/kb/orgs/ext-corp-com.md', message: 'disk full' } });
  });

  test('a failing source aborts the seed as source-failed, naming the source', async () => {
    const { seedKb } = setup({ 'list-my-direct-reports': err({ kind: 'command-failed', message: 'exited 3' }) });
    expect(await seedKb(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-my-direct-reports', message: 'exited 3' } });

    const authDown = setup({ 'get-current-user': err({ kind: 'command-failed', message: 'no valid session' }) });
    expect(await authDown.seedKb(OPTIONS)).toEqual({ ok: false, error: { kind: 'source-failed', source: 'get-current-user', message: 'no valid session' } });
  });

  test('an uninitialized kb refuses to seed', async () => {
    const refusing = createSeedKb({
      office: { execute: async () => err({ kind: 'unknown-command', message: 'unused' }) },
      files: { exists: async () => false },
      reader: { read: async () => err({ kind: 'read-failed', path: 'x', message: 'unused' }) },
      writer: { write: async () => ok(undefined) },
      clock: { todayIso: () => '2026-07-04', nowIso: () => '2026-07-04T00:00:00.000Z' },
      logger: createLoggerFake(),
    });

    expect(await refusing(OPTIONS)).toEqual({ ok: false, error: { kind: 'kb-not-initialized', message: 'run kb-init first' } });
  });
});

import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { CommandOutput, RunError } from './ports/command-runner.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';
import { createSeedKb } from './seed-kb.ts';
import type { SeedKb } from './seed-kb.ts';

type Responses = Readonly<Record<string, Result<CommandOutput, RunError>>>;

const envelope = (data: unknown): Result<CommandOutput, RunError> => ok({ stdout: JSON.stringify({ ok: true, data }), exitCode: 0 });

const SOURCES: Responses = {
  'ask-marcel get-current-user --output json': envelope({
    displayName: 'Test User',
    mail: 'me@internal-corp.com',
    userPrincipalName: 'me@internal-corp.com',
    jobTitle: 'Director',
  }),
  'ask-marcel get-my-manager --output json': envelope({ manager: null, note: 'signed-in user has no manager set in the directory' }),
  'ask-marcel list-my-direct-reports --output json': envelope({ value: [{ displayName: 'Report One', mail: 'report.one@internal-corp.com', jobTitle: 'Manager' }] }),
  'ask-marcel list-relevant-people --top 15 --output json': envelope({
    value: [{ displayName: 'Ext Vendor', scoredEmailAddresses: [{ address: 'vendor@ext-corp.com' }], jobTitle: 'Sales', companyName: 'Ext Corp' }],
  }),
};

const SEEDED_LOG = '# Log\n\n## 2026-07-04\n\n- kb-init: created the OKF skeleton\n';

type Written = { readonly path: string; readonly content: string };

type Setup = { readonly seedKb: SeedKb; readonly written: ReadonlyArray<Written> };

const setup = (overrides: Responses = {}, existingPages: ReadonlyArray<string> = [], failWrite?: WriteError): Setup => {
  const responses = { ...SOURCES, ...overrides };
  const written: Written[] = [];
  const writer: FileWriter = {
    write: async (path, content) => {
      if (failWrite !== undefined && failWrite.path === path) return err(failWrite);
      written.push({ path, content });
      return ok(undefined);
    },
  };
  const seedKb = createSeedKb({
    runner: { run: async (cmd, args) => responses[[cmd, ...args].join(' ')] ?? err({ kind: 'not-found', message: `${cmd}: command not found` }) },
    files: { exists: async (path) => path === 'data/kb/index.md' || existingPages.includes(path) },
    reader: { read: async (path) => (path === 'data/kb/log.md' ? ok(SEEDED_LOG) : err({ kind: 'read-failed', path, message: 'missing' })) },
    writer,
    clock: { todayIso: () => '2026-07-04' },
    logger: createLoggerFake(),
  });
  return { seedKb, written };
};

const OPTIONS = { relevantTop: 15, pageCap: 40 };

describe('seed-kb', () => {
  test('a user without a manager in the directory seeds cleanly', async () => {
    const { seedKb, written } = setup();

    const result = await seedKb(OPTIONS);

    expect(result).toEqual({
      ok: true,
      value: {
        created: ['data/kb/orgs/ext-corp-com.md', 'data/kb/orgs/internal-corp-com.md', 'data/kb/people/report-one.md', 'data/kb/people/ext-vendor.md'],
        skipped: [],
        dropped: 0,
      },
    });
    expect(written.find((w) => w.path === 'data/kb/orgs/internal-corp-com.md')?.content).toContain('relationship: internal');
    expect(written.find((w) => w.path === 'data/kb/orgs/ext-corp-com.md')?.content).toContain('relationship: external');
  });

  test('the same human via two sources gets one page', async () => {
    const { seedKb } = setup({
      'ask-marcel get-my-manager --output json': envelope({ manager: { displayName: 'Jane Boss', mail: 'jane@internal-corp.com', jobTitle: 'VP' } }),
      'ask-marcel list-relevant-people --top 15 --output json': envelope({
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

  test('malformed CLI json becomes a parse error, not a crash', async () => {
    const { seedKb } = setup({ 'ask-marcel list-relevant-people --top 15 --output json': ok({ stdout: 'segfault haha', exitCode: 0 }) });

    const result = await seedKb(OPTIONS);

    expect(result).toEqual({ ok: false, error: { kind: 'source-failed', source: 'list-relevant-people', message: 'invalid json' } });
  });

  test('the seed respects the page cap and reports what it dropped', async () => {
    const { seedKb } = setup();

    const result = await seedKb({ relevantTop: 15, pageCap: 3 });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.created).toEqual(['data/kb/orgs/ext-corp-com.md', 'data/kb/orgs/internal-corp-com.md', 'data/kb/people/report-one.md']);
    expect(result.value.dropped).toBe(1);
  });

  test('an uninitialized kb refuses to seed', async () => {
    const refusing = createSeedKb({
      runner: { run: async () => err({ kind: 'not-found', message: 'unused' }) },
      files: { exists: async () => false },
      reader: { read: async () => err({ kind: 'read-failed', path: 'x', message: 'unused' }) },
      writer: { write: async () => ok(undefined) },
      clock: { todayIso: () => '2026-07-04' },
      logger: createLoggerFake(),
    });

    expect(await refusing(OPTIONS)).toEqual({ ok: false, error: { kind: 'kb-not-initialized', message: 'run kb-init first' } });
  });
});

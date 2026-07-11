import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import { createLintKb } from './lint-kb.ts';

const CONFORMANT = '---\ntype: person\ntitle: Jane Boss\ndescription: VP of Retail\ntimestamp: 2026-07-06\n---\n\nbody';

type Opts = { readonly failList?: boolean; readonly failRead?: string };

const setup = (
  paths: ReadonlyArray<string>,
  contents: Record<string, string>,
  opts: Opts = {}
): { readonly lint: ReturnType<typeof createLintKb>; readonly logger: LoggerFake } => {
  const logger = createLoggerFake();
  const lint = createLintKb({
    lister: { list: async () => (opts.failList === true ? err({ kind: 'list-failed', message: 'scan crashed' }) : ok(paths)) },
    reader: { read: async (path: string) => (opts.failRead === path ? err({ kind: 'read-failed', path, message: 'unreadable' }) : ok(contents[path] ?? '')) },
    clock: { todayIso: () => '2026-07-11', nowIso: () => '2026-07-11T00:00:00.000Z' },
    logger,
  });
  return { lint, logger };
};

describe('lint-kb', () => {
  test('reads every KB page and reports only the concept pages that break OKF conformance', async () => {
    // jane and broken link each other so the graph checks (orphan) stay quiet - this test pins conformance
    const { lint, logger } = setup(['data/kb/people/jane.md', 'data/kb/topics/broken.md', 'data/kb/people/index.md'], {
      'data/kb/people/jane.md': CONFORMANT.replace('body', 'see [t](../topics/broken.md)'),
      'data/kb/topics/broken.md': '# broken\n\nsee [jane](../people/jane.md)\n\nno frontmatter',
      'data/kb/people/index.md': '# People\n\nreserved',
    });

    const result = await lint();

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.pagesLinted).toBe(3);
    // the conformant page and the reserved index produce nothing; only the broken concept page is flagged
    expect(result.value.issues).toEqual([{ path: 'data/kb/topics/broken.md', kind: 'no-frontmatter', detail: 'page has no --- frontmatter block' }]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'kb-linted', meta: { pages: 3, issues: 1 } }]);
  });

  test('a listing failure surfaces as a typed error', async () => {
    expect(await setup([], {}, { failList: true }).lint()).toEqual({ ok: false, error: { kind: 'list-failed', message: 'scan crashed' } });
  });

  test('a page that cannot be read surfaces as a typed error', async () => {
    expect(await setup(['data/kb/people/jane.md'], {}, { failRead: 'data/kb/people/jane.md' }).lint()).toEqual({
      ok: false,
      error: { kind: 'read-failed', path: 'data/kb/people/jane.md', message: 'unreadable' },
    });
  });
});

import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import type { LoggerFake } from '../test-helpers/logger-fake.ts';
import type { CommandOutput, RunError } from './ports/command-runner.ts';
import type { OfficeError } from './ports/office.ts';
import { createSearchRound } from './search-round.ts';
import type { SearchRequest } from './search-round.ts';

type OfficeResp = Result<unknown, OfficeError>;
type RunnerResp = Result<CommandOutput, RunError>;
type OfficeCall = { readonly command: string; readonly params: Record<string, string> };

type Overrides = { readonly kb?: RunnerResp; readonly mail?: OfficeResp; readonly sharepoint?: OfficeResp };

const kbJson = (hits: ReadonlyArray<unknown>): RunnerResp => ok({ stdout: JSON.stringify(hits), exitCode: 0 });
const mailData = (messages: ReadonlyArray<unknown>): OfficeResp => ok({ value: messages });
const sharepointData = (hits: ReadonlyArray<unknown>): OfficeResp => ok({ value: [{ hitsContainers: [{ hits }] }] });
const commandFailed = (message: string): OfficeResp => err({ kind: 'command-failed', message });

type Setup = {
  readonly searchRound: ReturnType<typeof createSearchRound>;
  readonly officeLog: ReadonlyArray<OfficeCall>;
  readonly runnerLog: ReadonlyArray<string>;
  readonly logger: LoggerFake;
};

const setup = (overrides: Overrides = {}): Setup => {
  const officeLog: OfficeCall[] = [];
  const runnerLog: string[] = [];
  const logger = createLoggerFake();
  const searchRound = createSearchRound({
    office: {
      execute: async (command, params) => {
        officeLog.push({ command, params });
        if (command === 'search-mail-messages') return overrides.mail ?? mailData([]);
        if (command === 'microsoft-search-query') return overrides.sharepoint ?? sharepointData([]);
        return err({ kind: 'unknown-command', message: command });
      },
    },
    runner: {
      run: async (cmd, args) => {
        runnerLog.push([cmd, ...args].join(' '));
        return overrides.kb ?? kbJson([]);
      },
    },
    logger,
  });
  return { searchRound, officeLog, runnerLog, logger };
};

const ALL: SearchRequest = { query: 'Q3 envelope', backends: ['kb', 'mail', 'sharepoint'] };

describe('search-round', () => {
  test('every requested backend runs in parallel and returns one merged, source-tagged list', async () => {
    const { searchRound, officeLog, runnerLog, logger } = setup({
      kb: kbJson([{ docid: '#a', file: 'qmd://ask-marcel-kb/topics/q3.md', title: 'Q3', snippet: 'kb snippet' }]),
      mail: mailData([{ id: 'm1', subject: 'RE: Q3', bodyPreview: 'mail preview', webLink: 'https://outlook/m1' }]),
      sharepoint: sharepointData([{ hitId: 'h1', summary: 'sp summary', resource: { name: 'Q3.xlsx', webUrl: 'https://sp/q3' } }]),
    });

    const result = await searchRound(ALL);

    // the kb backend rides qmd; mail and sharepoint ride the library search commands
    expect(runnerLog).toEqual(['qmd search Q3 envelope -c ask-marcel-kb --json -n 20']);
    expect(officeLog).toContainEqual({ command: 'search-mail-messages', params: { query: 'Q3 envelope', top: '20', select: 'id,subject,bodyPreview,webLink' } });
    expect(officeLog).toContainEqual({ command: 'microsoft-search-query', params: { query: 'Q3 envelope' } });
    expect(result.errors).toEqual([]);
    expect(result.hits).toEqual([
      { source: 'kb', id: '#a', title: 'Q3', snippet: 'kb snippet', uri: 'qmd://ask-marcel-kb/topics/q3.md' },
      { source: 'mail', id: 'm1', title: 'RE: Q3', snippet: 'mail preview', uri: 'https://outlook/m1' },
      { source: 'sharepoint', id: 'h1', title: 'Q3.xlsx', snippet: 'sp summary', uri: 'https://sp/q3?web=1' },
    ]);
    expect(logger.calls).toEqual([{ level: 'info', event: 'search-round', meta: { query: 'Q3 envelope', backends: 3, hits: 3, errors: 0 } }]);
  });

  test('only the requested backends are queried', async () => {
    const { searchRound, officeLog, runnerLog } = setup();

    await searchRound({ query: 'x', backends: ['kb'] });

    expect(runnerLog).toHaveLength(1);
    expect(officeLog).toEqual([]);
  });

  test('a backend failure is recorded while the others still contribute their hits', async () => {
    const { searchRound } = setup({
      kb: kbJson([{ file: 'qmd://ask-marcel-kb/topics/q3.md', title: 'Q3', snippet: 'via kb' }]),
      mail: commandFailed('403 forbidden'),
      sharepoint: commandFailed('search service unavailable'),
    });

    const result = await searchRound(ALL);

    // kb still contributes; both failing library backends are recorded, each named
    expect(result.hits).toEqual([{ source: 'kb', id: 'qmd://ask-marcel-kb/topics/q3.md', title: 'Q3', snippet: 'via kb', uri: 'qmd://ask-marcel-kb/topics/q3.md' }]);
    expect(result.errors).toEqual([
      { backend: 'mail', message: '403 forbidden' },
      { backend: 'sharepoint', message: 'search service unavailable' },
    ]);
  });

  test('a document surfaced by two backends under the same uri is deduped', async () => {
    const { searchRound } = setup({
      kb: kbJson([{ file: 'https://sp/shared', title: 'Shared', snippet: 'via kb' }]),
      sharepoint: sharepointData([{ hitId: 'h1', summary: 'via sp', resource: { name: 'Shared', webUrl: 'https://sp/shared' } }]),
    });

    const result = await searchRound(ALL);

    // kb ran first, so its copy wins the shared uri
    expect(result.hits.filter((hit) => hit.uri === 'https://sp/shared')).toHaveLength(1);
    expect(result.hits.find((hit) => hit.uri === 'https://sp/shared')?.source).toBe('kb');
  });

  test('a qmd search that cannot run, exits non-zero, or returns invalid json records a kb error', async () => {
    const kbOnly: SearchRequest = { query: 'x', backends: ['kb'] };

    const spawnFailed = setup({ kb: err({ kind: 'spawn-failed', message: 'qmd crashed' }) });
    expect((await spawnFailed.searchRound(kbOnly)).errors).toEqual([{ backend: 'kb', message: 'qmd crashed' }]);

    const badJson = setup({ kb: ok({ stdout: 'not json', exitCode: 0 }) });
    expect((await badJson.searchRound(kbOnly)).errors).toEqual([{ backend: 'kb', message: 'invalid json' }]);

    const nonZero = setup({ kb: ok({ stdout: '', exitCode: 2 }) });
    expect((await nonZero.searchRound(kbOnly)).errors).toEqual([{ backend: 'kb', message: 'exited 2' }]);
  });
});

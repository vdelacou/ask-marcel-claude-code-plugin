import { describe, expect, test } from 'bun:test';

import { err, ok } from '../domain/result.ts';
import { createLoggerFake } from '../test-helpers/logger-fake.ts';
import { createInitKb } from './init-kb.ts';
import type { InitKb } from './init-kb.ts';
import type { FileProbe } from './ports/file-probe.ts';
import type { FileWriter, WriteError } from './ports/file-writer.ts';

type Written = { readonly path: string; readonly content: string };

type WriterFake = FileWriter & {
  readonly written: ReadonlyArray<Written>;
  readonly failOn: (path: string, error: WriteError) => void;
};

const createWriterFake = (): WriterFake => {
  const written: Written[] = [];
  const failures = new Map<string, WriteError>();
  return {
    written,
    failOn: (path, error) => {
      failures.set(path, error);
    },
    write: async (path, content) => {
      const failure = failures.get(path);
      if (failure) return err(failure);
      written.push({ path, content });
      return ok(undefined);
    },
  };
};

const TODAY = '2026-07-04';

type Setup = { readonly initKb: InitKb; readonly writer: WriterFake };

const setup = (kbExists: boolean): Setup => {
  const files: FileProbe = { exists: async () => kbExists };
  const writer = createWriterFake();
  const initKb = createInitKb({ files, writer, clock: { todayIso: () => TODAY, nowIso: () => `${TODAY}T00:00:00.000Z` }, logger: createLoggerFake() });
  return { initKb, writer };
};

const contentOf = (writer: WriterFake, path: string): string => {
  const found = writer.written.find((w) => w.path === path);
  if (found === undefined) throw new Error(`nothing written at ${path}`);
  return found.content;
};

const ROOT_INDEX = `---
okf_version: "0.1"
---

# Knowledge Base

Open Knowledge Format bundle for the inbox-zero reply plugin (SPEC.md §8).

- [People](/people/index.md) - one page per person: identity, org links, commitments.
- [Orgs](/orgs/index.md) - organizations and teams: domains, relationships, key people.
- [Projects](/projects/index.md) - active projects and their state.
- [Topics](/topics/index.md) - topical knowledge that spans projects.
- [Decisions](/decisions/index.md) - dated decisions with their context.
- [Meetings](/meetings/index.md) - recurring meeting series.
- [Jargon](/jargon/index.md) - abbreviations and codenames, always loaded.
`;

const LOG_SEED = `# Log

## ${TODAY}

- kb-init: created the OKF skeleton
`;

const PEOPLE_INDEX = `# People

One page per person: identity, org links, commitments.

_No pages yet._
`;

const ABBREVIATIONS = `---
type: jargon
title: Abbreviations
description: Abbreviations, acronyms, and codenames from the user's mail - always loaded before any run.
tags:
  - jargon
timestamp: ${TODAY}
---

# Abbreviations

_None captured yet. The wrap-up phase of every run proposes new entries here._
`;

describe('init-kb', () => {
  test('a fresh data directory gets the full OKF skeleton in one pass', async () => {
    const { initKb, writer } = setup(false);

    const result = await initKb();

    expect(result).toEqual({
      ok: true,
      value: {
        created: [
          'data/kb/index.md',
          'data/kb/log.md',
          'data/kb/people/index.md',
          'data/kb/orgs/index.md',
          'data/kb/projects/index.md',
          'data/kb/topics/index.md',
          'data/kb/decisions/index.md',
          'data/kb/meetings/index.md',
          'data/kb/jargon/index.md',
          'data/kb/jargon/abbreviations.md',
        ],
      },
    });
    expect(contentOf(writer, 'data/kb/index.md')).toBe(ROOT_INDEX);
    expect(contentOf(writer, 'data/kb/log.md')).toBe(LOG_SEED);
    expect(contentOf(writer, 'data/kb/people/index.md')).toBe(PEOPLE_INDEX);
    expect(contentOf(writer, 'data/kb/jargon/abbreviations.md')).toBe(ABBREVIATIONS);
  });

  test('an already-initialized KB is left untouched', async () => {
    const { initKb, writer } = setup(true);

    const result = await initKb();

    expect(result).toEqual({ ok: true, value: { created: [] } });
    expect(writer.written).toEqual([]);
  });

  test('a write failure surfaces as an error naming the failing path', async () => {
    const { initKb, writer } = setup(false);
    writer.failOn('data/kb/log.md', { kind: 'write-failed', path: 'data/kb/log.md', message: 'disk full' });

    const result = await initKb();

    expect(result).toEqual({ ok: false, error: { kind: 'write-failed', path: 'data/kb/log.md', message: 'disk full' } });
  });

  test('every generated non-reserved page is OKF-conformant', async () => {
    const { initKb, writer } = setup(false);
    await initKb();

    const nonReserved = writer.written.filter((w) => !w.path.endsWith('/index.md') && !w.path.endsWith('/log.md'));
    expect(nonReserved.length).toBeGreaterThan(0);
    for (const page of nonReserved) {
      expect(page.content.startsWith('---\n')).toBe(true);
      expect(/^type: .+$/m.test(page.content)).toBe(true);
    }
  });
});

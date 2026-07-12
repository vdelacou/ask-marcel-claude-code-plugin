import { describe, expect, test } from 'bun:test';

import type { GraphClient, GraphError } from 'ask-marcel-office-cli';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createOffice, createOfficeFromRegistry, createOfficeLazy, runLogin, runLoginWith } from './office.ts';
import type { CommandRegistry, LibLoader } from './office.ts';

// The adapter passes graph opaquely to execute and never calls its methods — a sentinel is enough.
const SENTINEL_GRAPH = { marker: 'graph' } as unknown as GraphClient;

type RecordedCall = { readonly graph: GraphClient; readonly params: Record<string, string> };

const registryOf = (name: string, result: Result<unknown, GraphError>, log: RecordedCall[]): CommandRegistry => ({
  [name]: {
    execute: async (graph, params) => {
      log.push({ graph, params });
      return result;
    },
  },
});

describe('office adapter (lazy load)', () => {
  test('the library loads once on first execute and is reused - construction costs nothing', async () => {
    const log: RecordedCall[] = [];
    let loads = 0;
    const load: LibLoader = async () => {
      loads += 1;
      return { commands: registryOf('get-current-user', ok({ id: 'me' }), log) as never, buildDeps: () => ({ graph: SENTINEL_GRAPH }) as never };
    };
    const office = createOfficeLazy(load);
    expect(loads).toBe(0);

    expect(await office.execute('get-current-user', {})).toEqual({ ok: true, value: { id: 'me' } });
    expect(await office.execute('get-current-user', {})).toEqual({ ok: true, value: { id: 'me' } });
    expect(loads).toBe(1);
    expect(log).toHaveLength(2);
  });

  test('a library that fails to load surfaces as command-failed, never a crash', async () => {
    const office = createOfficeLazy(async () => {
      throw new Error('module not found');
    });

    expect(await office.execute('get-current-user', {})).toEqual({ ok: false, error: { kind: 'command-failed', message: 'module not found' } });
  });
});

describe('office adapter', () => {
  test('a known read command runs against the registry graph and returns its data unwrapped', async () => {
    const log: RecordedCall[] = [];
    const registry = registryOf('list-conversation-messages', ok({ value: [{ id: 'm1' }] }), log);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('list-conversation-messages', { conversationId: 'conv-1', select: 'id' });

    expect(result).toEqual({ ok: true, value: { value: [{ id: 'm1' }] } });
    // the real graph and the raw string params are handed straight to the library command
    expect(log).toEqual([{ graph: SENTINEL_GRAPH, params: { conversationId: 'conv-1', select: 'id' } }]);
  });

  test('an unknown command is refused as unknown-command without reaching Graph', async () => {
    const log: RecordedCall[] = [];
    const registry = registryOf('list-conversation-messages', ok({}), log);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('send-mail', { to: 'x@y.com' });

    expect(result).toEqual({ ok: false, error: { kind: 'unknown-command', message: 'unknown command: send-mail' } });
    expect(log).toEqual([]);
  });

  test('a Graph api_error surfaces as command-failed carrying its HTTP status', async () => {
    const registry = registryOf('read-mail-attachment', err({ type: 'api_error', status: 415, message: 'Unsupported Media Type', code: 'unsupported' }), []);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('read-mail-attachment', { messageId: 'm', attachmentId: 'a' });

    expect(result).toEqual({ ok: false, error: { kind: 'command-failed', message: 'Unsupported Media Type', status: 415 } });
  });

  test('a Graph auth, network, or validation error surfaces as command-failed without a status', async () => {
    const cases: ReadonlyArray<GraphError> = [
      { type: 'auth_failed', message: 'token expired' },
      { type: 'network_error', message: 'ECONNRESET' },
      { type: 'validation_error', message: 'messageId is required' },
    ];
    for (const graphError of cases) {
      const office = createOfficeFromRegistry(registryOf('get-mail-attachment', err(graphError), []), SENTINEL_GRAPH);

      const result = await office.execute('get-mail-attachment', { messageId: 'm', attachmentId: 'a' });

      expect(result).toEqual({ ok: false, error: { kind: 'command-failed', message: graphError.message } });
    }
  });
});

describe('createOffice (production wiring smoke)', () => {
  test('returns an Office port bound to the real command registry and shared-cache Graph client', () => {
    const office = createOffice();
    expect(typeof office.execute).toBe('function');
  });
});

describe('office login', () => {
  test('a successful token acquisition reports login ok', async () => {
    const login = runLoginWith(() => ({ getAccessToken: async () => ok('a-token') }));
    expect(await login()).toEqual({ ok: true, value: undefined });
  });

  test('an auth failure surfaces its message, and a cancelled login says so', async () => {
    const failed = runLoginWith(() => ({ getAccessToken: async () => err({ type: 'auth_failed', message: 'consent required' }) }));
    expect(await failed()).toEqual({ ok: false, error: { kind: 'command-failed', message: 'consent required' } });

    const cancelled = runLoginWith(() => ({ getAccessToken: async () => err({ type: 'auth_cancelled' }) }));
    expect(await cancelled()).toEqual({ ok: false, error: { kind: 'command-failed', message: 'login was cancelled' } });
  });

  test('runLogin is wired as a callable (production smoke)', () => {
    expect(typeof runLogin).toBe('function');
  });
});

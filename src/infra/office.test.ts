import { describe, expect, test } from 'bun:test';

import { accessTokenUnsafe } from 'ask-marcel-office-cli';
import type { AuthManager, GraphClient, GraphError } from 'ask-marcel-office-cli';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { createOffice, createOfficeFromRegistry, createOfficeLazy, withCommandAuthDeadline } from './office.ts';
import type { CommandRegistry, LibLoader } from './office.ts';

// The adapter passes graph opaquely to execute and never calls its methods — a sentinel is enough.
const SENTINEL_GRAPH = { marker: 'graph' } as unknown as GraphClient;

// The remedy carries the absolute login-entry path (runnable from any cwd); tests resolve it
// the same way the production module does.
const LOGIN_COMMAND = `bun "${Bun.fileURLToPath(new URL('../../scripts/login.ts', import.meta.url))}"`;

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
  test('the library loads once on first execute, wires the auth deadline into the graph, and is reused', async () => {
    const log: RecordedCall[] = [];
    let loads = 0;
    const wrapped: unknown[] = [];
    const load: LibLoader = async () => {
      loads += 1;
      return {
        commands: registryOf('get-current-user', ok({ id: 'me' }), log) as never,
        buildDeps: () => ({ auth: { getAccessToken: async () => ok(accessTokenUnsafe('eyJ-x')) } }) as never,
        createGraphClient: (auth: unknown) => {
          // the graph client must be built from the deadline-wrapped auth, not the raw one
          wrapped.push(auth);
          return SENTINEL_GRAPH;
        },
      };
    };
    const office = createOfficeLazy(load);
    expect(loads).toBe(0);

    expect(await office.execute('get-current-user', {})).toEqual({ ok: true, value: { id: 'me' } });
    expect(await office.execute('get-current-user', {})).toEqual({ ok: true, value: { id: 'me' } });
    expect(loads).toBe(1);
    expect(log).toHaveLength(2);
    expect(wrapped).toHaveLength(1);
    expect(typeof (wrapped[0] as AuthManager).getAccessToken).toBe('function');
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

  test('a Graph api_error surfaces as command-failed carrying its HTTP status and machine-readable code', async () => {
    const registry = registryOf('read-mail-attachment', err({ type: 'api_error', status: 415, message: 'Unsupported Media Type', code: 'unsupported' }), []);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('read-mail-attachment', { messageId: 'm', attachmentId: 'a' });

    expect(result).toEqual({ ok: false, error: { kind: 'command-failed', message: 'Unsupported Media Type', status: 415, code: 'unsupported' } });
  });

  test("a secondary-token fail-fast's remedy is rewritten from the CLI binary to the plugin login script", async () => {
    const libraryMessage =
      'Elevated (M365) token is expired or was not captured at login. Run `ask-marcel-office login` to (re)capture it — the CLI does not open a browser per command for this token.';
    const registry = registryOf('list-chats', err({ type: 'auth_failed', message: libraryMessage, code: 'secondary_token_unavailable' }), []);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('list-chats', {});

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'command-failed',
        message: `Elevated (M365) token is expired or was not captured at login. Run \`${LOGIN_COMMAND}\` to (re)capture it — the CLI does not open a browser per command for this token.`,
        code: 'secondary_token_unavailable',
      },
    });
  });

  test('a stuck-profile remedy (logout then login) is rewritten to the --fresh flag of the plugin login script', async () => {
    const libraryMessage =
      'elevated token capture timed out — silent SSO did not yield a Bearer within 20s. Run `ask-marcel-office logout && ask-marcel-office login` — this now wipes the profile too.';
    const registry = registryOf('get-chat', err({ type: 'auth_failed', message: libraryMessage }), []);
    const office = createOfficeFromRegistry(registry, SENTINEL_GRAPH);

    const result = await office.execute('get-chat', {});

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'command-failed',
        message: `elevated token capture timed out — silent SSO did not yield a Bearer within 20s. Run \`${LOGIN_COMMAND} --fresh\` — this now wipes the profile too.`,
      },
    });
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

describe('command-path auth deadline', () => {
  // Full-manager fake: the wrapper takes and returns the library's AuthManager so the
  // graph client can consume it; only getAccessToken varies per scenario.
  const authManagerOf = (getAccessToken: AuthManager['getAccessToken']): AuthManager => ({
    getAccessToken,
    getElevatedAccessToken: async () => err({ type: 'auth_failed', message: 'unused' }),
    getChatsvcaggAccessToken: async () => err({ type: 'auth_failed', message: 'unused' }),
    getChatsvcaggRegion: async () => 'emea',
    getIc3AccessToken: async () => err({ type: 'auth_failed', message: 'unused' }),
    logout: async () => ok(undefined),
    getLastElevatedOutcome: () => null,
    getLastChatsvcaggOutcome: () => null,
  });

  test('a token served from cache or refresh answers before the deadline and passes through untouched', async () => {
    const auth = withCommandAuthDeadline(
      authManagerOf(async () => ok(accessTokenUnsafe('eyJ-cached-token'))),
      50
    );

    const result = await auth.getAccessToken();

    expect(result).toEqual({ ok: true, value: accessTokenUnsafe('eyJ-cached-token') });
  });

  test('a stale session that would open an interactive browser fails fast with the plugin login remedy', async () => {
    const neverAnswers = new Promise<never>(() => {});
    const auth = withCommandAuthDeadline(
      authManagerOf(() => neverAnswers),
      5
    );

    const result = await auth.getAccessToken();

    expect(result).toEqual({
      ok: false,
      error: {
        type: 'auth_failed',
        message: `no valid Microsoft 365 session (the cached token is stale and refreshing it needs an interactive sign-in). Run \`${LOGIN_COMMAND}\` — commands never wait on a browser.`,
        code: 'interactive_login_required',
      },
    });
  });

  test('the deadline wraps only the primary token getter; every other auth capability is preserved', async () => {
    const source = authManagerOf(async () => ok(accessTokenUnsafe('eyJ-cached-token')));
    const auth = withCommandAuthDeadline(source, 50);

    expect(auth.logout).toBe(source.logout);
    expect(auth.getElevatedAccessToken).toBe(source.getElevatedAccessToken);
    expect(auth.getLastElevatedOutcome).toBe(source.getLastElevatedOutcome);
  });
});

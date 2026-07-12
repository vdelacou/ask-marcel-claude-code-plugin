import { describe, expect, test } from 'bun:test';

import type { AuthError } from 'ask-marcel-office-cli';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { runLogin, runLoginWith } from './office-login.ts';

// The remedy carries the absolute login-entry path (runnable from any cwd); tests resolve it
// the same way the production module does.
const LOGIN_COMMAND = `bun "${Bun.fileURLToPath(new URL('../../scripts/login.ts', import.meta.url))}"`;

describe('office login', () => {
  type CompanionSource = { readonly captured: true } | { readonly captured: false; readonly reason: string };
  type AuthScript = {
    readonly token?: Result<unknown, AuthError>;
    readonly wipe?: Result<unknown, AuthError>;
    readonly elevated?: CompanionSource;
    readonly chatsvcagg?: CompanionSource;
  };

  // Hand-written fake of the login AuthManager slice; records call order so tests
  // can pin that --fresh wipes BEFORE signing in (and a plain login never wipes).
  const authOf = (script: AuthScript, calls: string[]) => () => ({
    getAccessToken: async (): Promise<Result<unknown, AuthError>> => {
      calls.push('getAccessToken');
      return script.token ?? ok('a-token');
    },
    logout: async (): Promise<Result<unknown, AuthError>> => {
      calls.push('logout');
      return script.wipe ?? ok(undefined);
    },
    getLastElevatedOutcome: (): CompanionSource | null => script.elevated ?? null,
    getLastChatsvcaggOutcome: (): CompanionSource | null => script.chatsvcagg ?? null,
  });

  test('a login served from the cached session reports the companion tokens as untested and never wipes', async () => {
    const calls: string[] = [];
    const login = runLoginWith(authOf({}, calls));

    const result = await login();

    expect(result).toEqual({ ok: true, value: { elevated: { status: 'untested' }, chatsvcagg: { status: 'untested' } } });
    expect(calls).toEqual(['getAccessToken']);
  });

  test('a browser sign-in that captured both companion tokens reports them captured', async () => {
    const login = runLoginWith(authOf({ elevated: { captured: true }, chatsvcagg: { captured: true } }, []));

    const result = await login();

    expect(result).toEqual({ ok: true, value: { elevated: { status: 'captured' }, chatsvcagg: { status: 'captured' } } });
  });

  test('a browser sign-in that missed a companion token names the reason so the user can retry --fresh', async () => {
    const login = runLoginWith(authOf({ elevated: { captured: false, reason: 'silent_sso_timeout' }, chatsvcagg: { captured: true } }, []));

    const result = await login();

    expect(result).toEqual({ ok: true, value: { elevated: { status: 'failed', reason: 'silent_sso_timeout' }, chatsvcagg: { status: 'captured' } } });
  });

  test('a --fresh login wipes the cached session and browser profile before signing in', async () => {
    const calls: string[] = [];
    const login = runLoginWith(authOf({ elevated: { captured: true }, chatsvcagg: { captured: true } }, calls));

    const result = await login({ fresh: true });

    expect(result).toEqual({ ok: true, value: { elevated: { status: 'captured' }, chatsvcagg: { status: 'captured' } } });
    expect(calls).toEqual(['logout', 'getAccessToken']);
  });

  test('a --fresh login whose wipe fails surfaces the failure without attempting a sign-in', async () => {
    const calls: string[] = [];
    const login = runLoginWith(authOf({ wipe: err({ type: 'auth_failed', message: 'EACCES: browser profile is locked' }) }, calls));

    const result = await login({ fresh: true });

    expect(result).toEqual({ ok: false, error: { kind: 'command-failed', message: 'EACCES: browser profile is locked' } });
    expect(calls).toEqual(['logout']);
  });

  test('an auth failure surfaces its message with the CLI-binary remedy rewritten, and a cancelled login says so', async () => {
    const failed = runLoginWith(authOf({ token: err({ type: 'auth_failed', message: 'refresh failed (400) — run `ask-marcel-office login`', code: 'refresh_rejected' }) }, []));
    expect(await failed()).toEqual({ ok: false, error: { kind: 'command-failed', message: `refresh failed (400) — run \`${LOGIN_COMMAND}\``, code: 'refresh_rejected' } });

    const stuck = runLoginWith(
      authOf({ token: err({ type: 'auth_failed', message: 'profile is corrupt. Run `ask-marcel-office logout && ask-marcel-office login` to wipe it.' }) }, [])
    );
    expect(await stuck()).toEqual({ ok: false, error: { kind: 'command-failed', message: `profile is corrupt. Run \`${LOGIN_COMMAND} --fresh\` to wipe it.` } });

    const cancelled = runLoginWith(authOf({ token: err({ type: 'auth_cancelled' }) }, []));
    expect(await cancelled()).toEqual({ ok: false, error: { kind: 'command-failed', message: 'login was cancelled' } });
  });

  test('runLogin is wired as a callable (production smoke)', () => {
    expect(typeof runLogin).toBe('function');
  });
});

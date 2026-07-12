import { buildDeps } from 'ask-marcel-office-cli';
import type { AuthError } from 'ask-marcel-office-cli';

import { rewriteBinaryRemedy } from '../domain/login-remedy.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { OfficeError } from '../use-cases/ports/office.ts';
import { loginCommand } from './login-entry.ts';

// Minimal slice of the AuthManager used for login (rule 13 seam); the real manager satisfies it.
type CompanionSource = { readonly captured: true } | { readonly captured: false; readonly reason: string };
type LoginAuth = {
  readonly getAccessToken: () => Promise<Result<unknown, AuthError>>;
  readonly logout: () => Promise<Result<unknown, AuthError>>;
  readonly getLastElevatedOutcome: () => CompanionSource | null;
  readonly getLastChatsvcaggOutcome: () => CompanionSource | null;
};

// Companion (elevated / teams-chat) capture state after a login: 'untested' means the cached
// session answered and no browser ran — the tokens were not (re)captured in this process.
export type CompanionOutcome = { readonly status: 'captured' | 'untested' } | { readonly status: 'failed'; readonly reason: string };
export type LoginSummary = { readonly elevated: CompanionOutcome; readonly chatsvcagg: CompanionOutcome };

const toCompanionOutcome = (source: CompanionSource | null): CompanionOutcome => {
  if (source === null) return { status: 'untested' };
  return source.captured ? { status: 'captured' } : { status: 'failed', reason: source.reason };
};

const toLoginError = (error: AuthError): OfficeError =>
  error.type === 'auth_cancelled'
    ? { kind: 'command-failed', message: 'login was cancelled' }
    : { kind: 'command-failed', message: rewriteBinaryRemedy(error.message, loginCommand()), ...(error.code === undefined ? {} : { code: error.code }) };

// Login (SPEC §15.1 R3): getAccessToken runs the cached -> refresh -> Playwright browser flow,
// re-authing interactively when the cache is empty or stale (one-time `bunx playwright install`
// for the browser binaries). `fresh` first wipes the token cache AND the persistent browser
// profile (the library's logout), so the sign-in and every companion-token capture start from
// zero — the stuck-session recovery the CLI gets from its logout command. Testable via an
// injected auth factory.
export const runLoginWith =
  (makeAuth: () => LoginAuth): ((options?: { readonly fresh?: boolean }) => Promise<Result<LoginSummary, OfficeError>>) =>
  async (options) => {
    const auth = makeAuth();
    if (options?.fresh === true) {
      const wiped = await auth.logout();
      if (!wiped.ok) return err(toLoginError(wiped.error));
    }
    const token = await auth.getAccessToken();
    if (!token.ok) return err(toLoginError(token.error));
    return ok({ elevated: toCompanionOutcome(auth.getLastElevatedOutcome()), chatsvcagg: toCompanionOutcome(auth.getLastChatsvcaggOutcome()) });
  };

export const runLogin = runLoginWith(() => buildDeps({}).makeLoginAuth());

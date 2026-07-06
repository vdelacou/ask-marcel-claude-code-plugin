import { buildDeps, commands } from 'ask-marcel-office-cli';
import type { AuthError, Command, GraphClient, GraphError } from 'ask-marcel-office-cli';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { Office, OfficeError } from '../use-cases/ports/office.ts';

// Minimal slice of the library's command registry — the only surface this adapter calls.
export type CommandRegistry = Record<string, Pick<Command, 'execute'>>;

const toOfficeError = (error: GraphError): OfficeError =>
  error.type === 'api_error' ? { kind: 'command-failed', message: error.message, status: error.status } : { kind: 'command-failed', message: error.message };

// Testable factory (pattern 2b): the registry + graph are injected so a fake registry
// exercises the lookup/guard/map orchestration without a real Graph client. The raw
// graph is passed to execute and never invoked here (SPEC §15.1 R2).
export const createOfficeFromRegistry = (registry: CommandRegistry, graph: GraphClient): Office => ({
  execute: async (command, params) => {
    // Own-property membership, not a value === undefined check: the registry index type omits
    // undefined (noUncheckedIndexedAccess is off), so hasOwn is the honest unknown-command guard.
    if (!Object.hasOwn(registry, command)) return err({ kind: 'unknown-command', message: `unknown command: ${command}` });
    const result = await registry[command].execute(graph, params);
    return result.ok ? ok(result.value) : err(toOfficeError(result.error));
  },
});

// Production wiring (R2/R3): the real curated command registry, and a Graph client bound
// to the CLI's shared token cache via buildDeps. The send-capable graph is never returned.
export const createOffice = (): Office => createOfficeFromRegistry(commands, buildDeps({}).graph);

// Minimal slice of the AuthManager used for login (rule 13 seam).
type LoginAuth = { readonly getAccessToken: () => Promise<Result<unknown, AuthError>> };

// Login (SPEC §15.1 R3): makeLoginAuth's getAccessToken runs the cached -> refresh -> Playwright
// browser flow, re-authing interactively when the cache is empty or stale (one-time `playwright
// install` for the browser binaries). Testable via an injected auth factory.
export const runLoginWith =
  (makeAuth: () => LoginAuth): (() => Promise<Result<void, OfficeError>>) =>
  async () => {
    const token = await makeAuth().getAccessToken();
    if (token.ok) return ok(undefined);
    return err({ kind: 'command-failed', message: token.error.type === 'auth_cancelled' ? 'login was cancelled' : token.error.message });
  };

export const runLogin = runLoginWith(() => buildDeps({}).makeLoginAuth());

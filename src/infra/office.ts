import type { AuthError, Command, GraphClient, GraphError } from 'ask-marcel-office-cli';

import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { Office, OfficeError } from '../use-cases/ports/office.ts';

// The library bundle costs ~0.24s to import (xlsx/mammoth/playwright JS ride along), which
// every script paid through buildDeps even when it never touched Microsoft 365 - dozens of
// state/queue/report spawns per run. The import is therefore DYNAMIC and memoized: only the
// first actual execute() (or login) pays it; state.ts and friends stay at bun-startup speed.
type Lib = Pick<typeof import('ask-marcel-office-cli'), 'buildDeps' | 'commands'>;

export type LibLoader = () => Promise<Lib>;

const loadLib: LibLoader = () => import('ask-marcel-office-cli');

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

// Lazy wiring seam (pattern 2b): the loader is injected so tests exercise the memoization
// and the load-failure path with a fake lib; production loads the real module once.
export const createOfficeLazy = (load: LibLoader): Office => {
  let real: Office | undefined;
  return {
    execute: async (command, params) => {
      if (real === undefined) {
        try {
          const lib = await load();
          real = createOfficeFromRegistry(lib.commands, lib.buildDeps({}).graph);
        } catch (thrown) {
          return err({ kind: 'command-failed', message: formatError(thrown) });
        }
      }
      return real.execute(command, params);
    },
  };
};

// Production wiring (R2/R3): the real curated command registry, and a Graph client bound
// to the CLI's shared token cache via buildDeps. The send-capable graph is never returned.
export const createOffice = (): Office => createOfficeLazy(loadLib);

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

export const runLogin = async (): Promise<Result<void, OfficeError>> => {
  const lib = await loadLib();
  return runLoginWith(() => lib.buildDeps({}).makeLoginAuth())();
};

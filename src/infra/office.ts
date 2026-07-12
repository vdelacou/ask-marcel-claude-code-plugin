import type { AccessToken, AuthError, AuthManager, Command, GraphClient, GraphError } from 'ask-marcel-office-cli';

import { rewriteBinaryRemedy } from '../domain/login-remedy.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { formatError } from '../domain/utilities/format-error.ts';
import type { Office, OfficeError } from '../use-cases/ports/office.ts';
import { loginCommand } from './login-entry.ts';

// The library bundle costs ~0.24s to import (xlsx/mammoth/playwright JS ride along), which
// every script paid through buildDeps even when it never touched Microsoft 365 - dozens of
// state/queue/report spawns per run. The import is therefore DYNAMIC and memoized: only the
// first actual execute() pays it; state.ts and friends stay at bun-startup speed.
type Lib = Pick<typeof import('ask-marcel-office-cli'), 'buildDeps' | 'commands' | 'createGraphClient'>;

export type LibLoader = () => Promise<Lib>;

const loadLib: LibLoader = () => import('ask-marcel-office-cli');

// Minimal slice of the library's command registry — the only surface this adapter calls.
export type CommandRegistry = Record<string, Pick<Command, 'execute'>>;

// Error remedies written for the CLI binary are rewritten to the plugin's login entry, and the
// library's machine-readable `code` rides along so callers can branch without string-matching.
const toOfficeError = (error: GraphError): OfficeError => ({
  kind: 'command-failed',
  message: rewriteBinaryRemedy(error.message, loginCommand()),
  ...(error.type === 'api_error' ? { status: error.status } : {}),
  ...(error.code === undefined ? {} : { code: error.code }),
});

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

// The library's primary-token ladder ends at an INTERACTIVE Playwright browser rung, so a
// command run with a stale cache + dead refresh token would pop a sign-in window and block up
// to 5 minutes — mid-skill, or unattended in a scheduled run. Commands must answer fast or
// fail with the login remedy; `bun scripts/login.ts` is the only sanctioned interactive surface.
const COMMAND_AUTH_DEADLINE_MS = 20_000;

const commandAuthDeadlineError = (): AuthError => ({
  type: 'auth_failed',
  message: `no valid Microsoft 365 session (the cached token is stale and refreshing it needs an interactive sign-in). Run \`${loginCommand()}\` — commands never wait on a browser.`,
  code: 'interactive_login_required',
});

export const withCommandAuthDeadline = (auth: AuthManager, deadlineMs: number): AuthManager => ({
  ...auth,
  getAccessToken: async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Result<AccessToken, AuthError>>((resolve) => {
      timer = setTimeout(() => resolve(err(commandAuthDeadlineError())), deadlineMs);
    });
    try {
      return await Promise.race([auth.getAccessToken(), deadline]);
    } finally {
      // Whichever branch wins, the pending timer must not hold the event loop open
      // (a leaked 20s timer would delay every script's exit by up to that long).
      if (timer !== undefined) clearTimeout(timer);
    }
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
          real = createOfficeFromRegistry(lib.commands, lib.createGraphClient(withCommandAuthDeadline(lib.buildDeps({}).auth, COMMAND_AUTH_DEADLINE_MS)));
        } catch (thrown) {
          return err({ kind: 'command-failed', message: formatError(thrown) });
        }
      }
      return real.execute(command, params);
    },
  };
};

// Production wiring (R2/R3): the real curated command registry, and a Graph client whose
// command-path auth answers from cache/refresh or fails fast — never a browser (see above).
// The send-capable graph is never returned.
export const createOffice = (): Office => createOfficeLazy(loadLib);

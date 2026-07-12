/*
 * Thin CLI entry: bun scripts/login.ts [--fresh] [--json]
 * Authenticate to Microsoft 365 through the library (SPEC.md §15.1 R3): the cached -> refresh ->
 * Playwright browser flow. Opens a browser when the cache is empty or stale; the sign-in wait is
 * interactive and can take up to ~5 minutes, so run it with a generous timeout. --fresh wipes the
 * token cache and the persistent browser profile first (the stuck-session recovery), forcing a
 * full sign-in that recaptures every companion token. --json prints a one-line envelope for
 * skills. One-time prerequisite: `bunx playwright install` for the browser binaries. Exit 1 on
 * failure or crash.
 */
import { formatError } from '../src/domain/utilities/format-error.ts';
import { runLogin } from '../src/infra/office-login.ts';
import type { CompanionOutcome } from '../src/infra/office-login.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, process.cwd()));

const fresh = Bun.argv.includes('--fresh');
const json = Bun.argv.includes('--json');

const describeCompanion = (outcome: CompanionOutcome): string => (outcome.status === 'failed' ? `failed (${outcome.reason})` : outcome.status);

try {
  if (!json) {
    console.log(
      fresh
        ? 'login: wiping the cached session and browser profile, then signing in fresh (a browser opens)...'
        : 'login: acquiring a Microsoft 365 session (a browser opens if re-auth is needed)...'
    );
  }
  const result = await runLogin({ fresh });
  if (result.ok) {
    const { elevated, chatsvcagg } = result.value;
    if (json) {
      console.log(JSON.stringify({ ok: true, fresh, elevated, chatsvcagg }));
    } else if (elevated.status === 'untested' && chatsvcagg.status === 'untested') {
      console.log('login: authenticated - cached session reused (companion tokens not re-tested; run with --fresh to force a full sign-in)');
    } else {
      console.log(`login: authenticated - token cached (companion tokens - elevated: ${describeCompanion(elevated)}, teams-chat: ${describeCompanion(chatsvcagg)})`);
    }
  } else {
    if (json) console.log(JSON.stringify({ ok: false, error: result.error }));
    else console.error(`login: ${result.error.message}`);
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}

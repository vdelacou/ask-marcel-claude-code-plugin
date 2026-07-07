/*
 * Thin CLI entry: bun scripts/login.ts
 * Authenticate to Microsoft 365 through the library (SPEC.md §15.1 R3): the cached -> refresh ->
 * Playwright browser flow. Opens a browser when the cache is empty or stale; the token is cached
 * for every other entry to reuse. One-time prerequisite: `bunx playwright install` for the browser
 * binaries. Exit 1 on failure or crash.
 */
import { formatError } from '../src/domain/utilities/format-error.ts';
import { runLogin } from '../src/infra/office.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

try {
  console.log('login: acquiring a Microsoft 365 session (a browser opens if re-auth is needed)...');
  const result = await runLogin();
  if (result.ok) {
    console.log('login: authenticated - token cached');
  } else {
    console.error(`login: ${result.error.message}`);
    process.exit(1);
  }
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}

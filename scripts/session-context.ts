/*
 * SessionStart hook entry (SPEC.md §3, design principle 6): print the always-loaded context -
 * data/profile/user.md and data/kb/jargon/abbreviations.md - so every session starts with the
 * user's standing instructions and the jargon decoder already in context. Prints nothing when
 * neither file exists (any non-ask-marcel workspace), and NEVER exits non-zero: a context hook
 * must not be able to break a session. Deliberately dependency-free (only the pure data-home
 * resolver) so it works before `bun install` has run in the plugin cache.
 */
import { resolveDataHome } from '../src/composition/data-home.ts';

const printIfPresent = async (heading: string, path: string): Promise<boolean> => {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return false;
    const text = (await file.text()).trim();
    if (text === '') return false;
    console.log(`\n### ${heading} (${path})\n`);
    console.log(text);
    return true;
  } catch {
    return false;
  }
};

try {
  process.chdir(resolveDataHome(process.env, process.cwd()));
  const userMd = await printIfPresent('ask-marcel always-loaded context - about the user', 'data/profile/user.md');
  const jargon = await printIfPresent('ask-marcel always-loaded context - jargon & abbreviations', 'data/kb/jargon/abbreviations.md');
  if (userMd || jargon) console.log('\n(ask-marcel: treat the two sections above as standing context for every mail/KB task in this session.)');
} catch {
  // A failing context hook must never block a session - exit clean, print nothing.
}

/*
 * Thin CLI entry: bun scripts/draft-preflight.ts [--file draft.md] [--subject "Re: x"]
 * The deterministic drafting gate: em/en dashes and anti-style phrases never
 * ship (SPEC.md §9). Body from --file or stdin; the subject is checked via
 * --subject without entering the body. Exit 0 clean, 1 findings, 2 read error.
 */
import { detectDraftFindings, parseAntiStyle } from '../src/domain/draft-preflight.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const readOptional = async (path: string): Promise<string> => {
  try {
    return await Bun.file(path).text();
  } catch {
    return '';
  }
};

try {
  const file = flagValue('--file', '');
  let body: string;
  try {
    body = file === '' ? await Bun.stdin.text() : await Bun.file(file).text();
  } catch (thrown) {
    console.error(`error: cannot read draft: ${formatError(thrown)}`);
    process.exit(2);
  }
  const subject = flagValue('--subject', '');
  const draft = subject === '' ? body : `${subject}\n${body}`;
  const profile = await readOptional(flagValue('--voice-profile', 'data/profile/voice-profile.md'));
  const catalog = await readOptional(flagValue('--anti-slop-catalog', `${import.meta.dir}/../references/anti-slop-catalog.md`));
  const findings = detectDraftFindings(draft, [...parseAntiStyle(profile), ...parseAntiStyle(catalog)]);
  for (const finding of findings) console.error(`line ${finding.line}: ${finding.kind} -> ${finding.detail}`);
  if (findings.length > 0) process.exit(1);
  console.log('draft-preflight: clean');
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}

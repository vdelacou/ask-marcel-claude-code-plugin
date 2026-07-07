/*
 * Thin CLI entry: bun scripts/write-kb-page.ts --page-file <path> [--json]
 * SPEC.md §8 kb-curator write: land ONE vetted OKF page under data/kb/, creating it or merging
 * new content under a dated Update section (never overwriting), and append a log line. The
 * page-file is a JSON KbPageInput: { folder, slug, type, title, description, resource?, tags[],
 * content, citations[] }. Exit 1 on error or crash.
 */
import { buildDeps } from '../src/composition/build-deps.ts';
import { loadConfig } from '../src/composition/config.ts';
import { asString, isRecord, parseJson } from '../src/domain/graph-envelopes.ts';
import type { KbPageInput } from '../src/domain/okf-page.ts';
import { formatError } from '../src/domain/utilities/format-error.ts';
import { createWriteKbPage } from '../src/use-cases/write-kb-page.ts';
import { resolveDataHome } from '../src/composition/data-home.ts';

process.chdir(resolveDataHome(process.env, `${import.meta.dir}/..`));

const flagValue = (name: string, fallback = ''): string => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const asStrings = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.map(asString).filter((entry): entry is string => entry !== undefined) : []);

const parsePage = (data: unknown): KbPageInput | undefined => {
  if (!isRecord(data)) return undefined;
  const folder = asString(data['folder']);
  const slug = asString(data['slug']);
  const type = asString(data['type']);
  const title = asString(data['title']);
  const description = asString(data['description']);
  const content = asString(data['content']);
  if (folder === undefined || slug === undefined || type === undefined || title === undefined || description === undefined || content === undefined) return undefined;
  return { folder, slug, type, title, description, resource: asString(data['resource']), tags: asStrings(data['tags']), content, citations: asStrings(data['citations']) };
};

try {
  const pageFile = flagValue('--page-file');
  if (pageFile === '') {
    console.error('write-kb-page: --page-file is required');
    process.exit(1);
  }
  const deps = buildDeps(loadConfig({ LOG_LEVEL: 'error', ...process.env }));
  const read = await deps.reader.read(pageFile);
  if (!read.ok) {
    console.error(`write-kb-page: cannot read --page-file (${read.error.message})`);
    process.exit(1);
  }
  const parsed = parseJson(read.value);
  const page = parsed.ok ? parsePage(parsed.value) : undefined;
  if (page === undefined) {
    console.error('write-kb-page: --page-file must be a JSON object with folder, slug, type, title, description and content');
    process.exit(1);
  }
  const result = await createWriteKbPage(deps)(page);
  if (Bun.argv.includes('--json')) {
    console.log(JSON.stringify(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error }));
  } else if (result.ok) {
    console.log(`write-kb-page: ${result.value.outcome} ${result.value.path}`);
  } else {
    console.error(`write-kb-page: ${JSON.stringify(result.error)}`);
  }
  if (!result.ok) process.exit(1);
} catch (thrown) {
  console.error(`crashed (unexpected): ${formatError(thrown)}`);
  process.exit(1);
}

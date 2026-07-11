import { readFrontmatter } from './kb-frontmatter.ts';
import { isReservedKbFile, kbSlugOf } from './okf-kb.ts';
import type { KbFile } from './okf-kb.ts';

// OKF conformance findings the gardener auto-detects (SPEC §8 kb-gardener Phase 1):
// frontmatter shape, duplicate slugs, broken internal links, staleness, and orphans.
export type LintIssue = {
  readonly path: string;
  readonly kind: 'no-frontmatter' | 'missing-field' | 'duplicate-slug' | 'broken-link' | 'stale' | 'orphan';
  readonly detail: string;
};

const REQUIRED_FIELDS: ReadonlyArray<string> = ['type', 'title', 'description', 'timestamp'];

/** A page older than this (by its `timestamp`) is reported stale for the gardener to review (SPEC §8). */
export const STALE_AFTER_DAYS = 180;

const DAY_MS = 86_400_000;

// index.md and log.md are reserved / generated files, not concept pages — they carry no OKF frontmatter.
// isReservedKbFile splits on both separators, so this holds on Windows where Bun.Glob yields backslash paths.
const isConceptPage = (path: string): boolean => !isReservedKbFile(path);

const conformanceIssues = (file: KbFile): ReadonlyArray<LintIssue> => {
  const fields = readFrontmatter(file.content);
  if (fields === undefined) return [{ path: file.path, kind: 'no-frontmatter', detail: 'page has no --- frontmatter block' }];
  return REQUIRED_FIELDS.filter((field) => !fields.has(field)).map((field) => ({ path: file.path, kind: 'missing-field', detail: `missing required field: ${field}` }));
};

// One human/topic = one page: the same slug under two folders is a duplicate the gardener must merge.
const duplicateSlugIssues = (pages: ReadonlyArray<KbFile>): ReadonlyArray<LintIssue> => {
  const byslug = new Map<string, string[]>();
  for (const page of pages) {
    const slug = kbSlugOf(page.path);
    byslug.set(slug, [...(byslug.get(slug) ?? []), page.path]);
  }
  const issues: LintIssue[] = [];
  for (const [slug, group] of byslug) {
    if (group.length < 2) continue;
    for (const path of group) issues.push({ path, kind: 'duplicate-slug', detail: `slug '${slug}' is shared by ${group.length} pages` });
  }
  return issues;
};

// Forward slashes everywhere so Windows backslash paths compare equal to the links inside pages.
const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const dirOf = (path: string): string => {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
};

// Resolve `..`/`.` segments against a base directory without node:path (domain stays dependency-free).
const joinSegments = (base: string, target: string): string => {
  const segments = base === '' ? [] : base.split('/');
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
};

// Markdown link targets, without a regex (linear scan; quantified-class regexes trip sonarjs).
const linkTargets = (content: string): ReadonlyArray<string> => {
  const targets: string[] = [];
  const chunks = content.split('](');
  for (const chunk of chunks.slice(1)) {
    const close = chunk.indexOf(')');
    if (close !== -1) targets.push(chunk.slice(0, close));
  }
  return targets;
};

const isExternalTarget = (target: string): boolean => target.includes('://') || target.startsWith('mailto:');

// A lintable internal target resolved to a bundle path: `/people/x.md` is bundle-absolute
// (anchored at the KB root), anything else is relative to the linking page. Anchors and
// query strings are stripped; only `.md` targets are checked (images etc. are out of scope).
const resolveInternalTarget = (pagePath: string, rawTarget: string): string | undefined => {
  const target = rawTarget.split('#')[0]?.split('?')[0] ?? '';
  if (target === '' || isExternalTarget(target) || !target.endsWith('.md')) return undefined;
  return target.startsWith('/') ? joinSegments('data/kb', target) : joinSegments(dirOf(pagePath), target);
};

type ResolvedLink = { readonly page: KbFile; readonly rawTarget: string; readonly resolved: string };

const internalLinks = (pages: ReadonlyArray<KbFile>): ReadonlyArray<ResolvedLink> =>
  pages.flatMap((page) =>
    linkTargets(page.content).flatMap((rawTarget) => {
      const resolved = resolveInternalTarget(page.path, rawTarget);
      return resolved === undefined ? [] : [{ page, rawTarget, resolved }];
    })
  );

// A link may point at any listed KB file (concept page, folder index, log) — reserved files are valid targets.
const brokenLinkIssues = (pages: ReadonlyArray<KbFile>, allFiles: ReadonlyArray<KbFile>): ReadonlyArray<LintIssue> => {
  const known = new Set(allFiles.map((file) => normalizePath(file.path)));
  return internalLinks(pages)
    .filter((link) => !known.has(link.resolved))
    .map((link) => ({ path: link.page.path, kind: 'broken-link' as const, detail: `link target does not exist: ${link.rawTarget}` }));
};

const staleIssues = (pages: ReadonlyArray<KbFile>, todayIso: string): ReadonlyArray<LintIssue> => {
  const today = Date.parse(todayIso);
  const issues: LintIssue[] = [];
  for (const page of pages) {
    const timestamp = readFrontmatter(page.content)?.get('timestamp') ?? '';
    const written = Date.parse(timestamp);
    if (Number.isNaN(written) || Number.isNaN(today)) continue; // absence is missing-field's finding, not stale's
    const ageDays = (today - written) / DAY_MS;
    if (ageDays > STALE_AFTER_DAYS) issues.push({ path: page.path, kind: 'stale', detail: `timestamp ${timestamp} is ${Math.floor(ageDays)} days old (> ${STALE_AFTER_DAYS})` });
  }
  return issues;
};

// A concept page no other concept page links to. Generated folder indexes list every page,
// so reachability-from-index is meaningless — the signal is peer references (SPEC §8).
// Normal on a young KB; the gardener treats it as review-worthy, never auto-deletes.
// Jargon pages are lookup tables (always-loaded), not graph nodes — exempt.
const orphanIssues = (pages: ReadonlyArray<KbFile>): ReadonlyArray<LintIssue> => {
  const linkedTargets = new Set(internalLinks(pages).map((link) => link.resolved));
  return pages
    .filter((page) => readFrontmatter(page.content)?.get('type') !== 'jargon')
    .filter((page) => !linkedTargets.has(normalizePath(page.path)))
    .map((page) => ({ path: page.path, kind: 'orphan' as const, detail: 'no other concept page links to this page' }));
};

export const lintKb = (files: ReadonlyArray<KbFile>, todayIso: string): ReadonlyArray<LintIssue> => {
  const pages = files.filter((file) => isConceptPage(file.path));
  return [...pages.flatMap(conformanceIssues), ...duplicateSlugIssues(pages), ...brokenLinkIssues(pages, files), ...staleIssues(pages, todayIso), ...orphanIssues(pages)];
};

// The post-write lint for ONE page (write-kb-page runs it on what it just landed): only the
// corpus-independent conformance checks — links/duplicates/orphans need the whole KB and
// belong to the gardener's full pass.
export const lintKbPage = (file: KbFile): ReadonlyArray<LintIssue> => (isConceptPage(file.path) ? conformanceIssues(file) : []);

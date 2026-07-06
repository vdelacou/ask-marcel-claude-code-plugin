import { readFrontmatter } from './kb-frontmatter.ts';
import type { KbFile } from './okf-kb.ts';

// OKF conformance findings the gardener auto-detects (SPEC §8 kb-gardener Phase 1).
export type LintIssue = { readonly path: string; readonly kind: 'no-frontmatter' | 'missing-field' | 'duplicate-slug'; readonly detail: string };

const REQUIRED_FIELDS: ReadonlyArray<string> = ['type', 'title', 'description', 'timestamp'];

// index.md and log.md are reserved / generated files, not concept pages — they carry no OKF frontmatter.
const isConceptPage = (path: string): boolean => !path.endsWith('/index.md') && !path.endsWith('/log.md');

const slugOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

const conformanceIssues = (file: KbFile): ReadonlyArray<LintIssue> => {
  const fields = readFrontmatter(file.content);
  if (fields === undefined) return [{ path: file.path, kind: 'no-frontmatter', detail: 'page has no --- frontmatter block' }];
  return REQUIRED_FIELDS.filter((field) => !fields.has(field)).map((field) => ({ path: file.path, kind: 'missing-field', detail: `missing required field: ${field}` }));
};

// One human/topic = one page: the same slug under two folders is a duplicate the gardener must merge.
const duplicateSlugIssues = (pages: ReadonlyArray<KbFile>): ReadonlyArray<LintIssue> => {
  const byslug = new Map<string, string[]>();
  for (const page of pages) {
    const slug = slugOf(page.path);
    byslug.set(slug, [...(byslug.get(slug) ?? []), page.path]);
  }
  const issues: LintIssue[] = [];
  for (const [slug, group] of byslug) {
    if (group.length < 2) continue;
    for (const path of group) issues.push({ path, kind: 'duplicate-slug', detail: `slug '${slug}' is shared by ${group.length} pages` });
  }
  return issues;
};

export const lintKb = (files: ReadonlyArray<KbFile>): ReadonlyArray<LintIssue> => {
  const pages = files.filter((file) => isConceptPage(file.path));
  return [...pages.flatMap(conformanceIssues), ...duplicateSlugIssues(pages)];
};

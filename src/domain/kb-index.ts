import { readFrontmatter } from './kb-frontmatter.ts';
import { kbSlugOf } from './okf-kb.ts';
import type { KbFile } from './okf-kb.ts';

type IndexEntry = { readonly slug: string; readonly title: string; readonly description: string };

const toEntry = (page: KbFile): IndexEntry => {
  const fields = readFrontmatter(page.content);
  const slug = kbSlugOf(page.path);
  return { slug, title: fields?.get('title') ?? slug, description: fields?.get('description') ?? '' };
};

// Proper alphabetical order for the human-readable index. The generated index.md is gitignored
// runtime data, so localeCompare's host-locale dependence causes no cross-host diff (unlike a
// committed artifact). Array.sort is stable: equal titles keep the lister's slug order.
const byTitle = (a: IndexEntry, b: IndexEntry): number => a.title.localeCompare(b.title);

const entryLine = (entry: IndexEntry): string => {
  const suffix = entry.description === '' ? '' : ` - ${entry.description}`;
  return `- [${entry.title}](${entry.slug}.md)${suffix}`;
};

// Regenerate a folder's index.md from its concept pages - derived data, never hand-curated (SPEC §8).
export const renderFolderIndex = (heading: string, pages: ReadonlyArray<KbFile>): string => {
  const body = pages.length === 0 ? ['_No pages yet._'] : [...pages].map(toEntry).sort(byTitle).map(entryLine);
  return [`# ${heading}`, '', ...body, ''].join('\n');
};

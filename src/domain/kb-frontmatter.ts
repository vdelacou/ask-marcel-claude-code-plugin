// Parse the top-level scalar fields of a KB page's `---` frontmatter block (the inverse of
// okf-page's renderer). Nested / list values (e.g. `tags:` with indented `- item` lines) key to an
// empty string; a page without a leading `---` block (index.md, log.md) yields undefined.
export const readFrontmatter = (content: string): ReadonlyMap<string, string> | undefined => {
  if (!content.startsWith('---\n')) return undefined;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return undefined;
  const fields = new Map<string, string>();
  for (const line of content.slice(4, end).split('\n')) {
    // Skip indented (nested / list) lines and any line without a `key: value` colon (blanks included).
    if (line.startsWith(' ') || !line.includes(':')) continue;
    const colon = line.indexOf(':');
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return fields;
};

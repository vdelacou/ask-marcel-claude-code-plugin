export type Quality = 'good' | 'scrambled';

// A markdown conversion is 'scrambled' (SPEC §7) when it is near-empty, dense with the Unicode
// replacement character (a scanned-image OCR failure), or table-soup — its visible characters are
// mostly table-drawing rules rather than prose. Char predicates only (no regex; see LESSONS).
const MIN_CONTENT_CHARS = 24;
const MAX_REPLACEMENT_RATIO = 0.1;
const MAX_RULE_RATIO = 0.6;

export const assessMarkdownQuality = (markdown: string): Quality => {
  const chars = [...markdown.trim()];
  if (chars.length < MIN_CONTENT_CHARS) return 'scrambled';
  const replacements = chars.filter((char) => char === '�').length;
  if (replacements / chars.length > MAX_REPLACEMENT_RATIO) return 'scrambled';
  // `char > ' '` keeps every printable character (any script) and drops spaces and C0 controls.
  const visible = chars.filter((char) => char > ' ');
  const rules = visible.filter((char) => char === '|' || char === '-').length;
  return visible.length > 0 && rules / visible.length > MAX_RULE_RATIO ? 'scrambled' : 'good';
};

/**
 * Deterministic draft gate (SPEC.md §9, decision 21): em/en dashes and literal
 * anti-style phrases never ship. Phrase lists come from fenced code blocks that
 * sit under an "Anti-style" / "Anti-slop" heading in the voice profile and the
 * carried catalog (references/anti-slop-catalog.md). Ported from the
 * ask-marcel-plugin gate (provenance: SPEC.md §12).
 */

export type Finding = { readonly line: number; readonly kind: 'em-dash' | 'en-dash' | 'phrase'; readonly detail: string };

/** Phrases from every fenced block under an anti-style/anti-slop heading: one per line, no markers. */
export const parseAntiStyle = (markdown: string): ReadonlyArray<string> => {
  const phrases: string[] = [];
  let armed = false;
  let inBlock = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) armed = line.toLowerCase().includes('anti-style') || line.toLowerCase().includes('anti-slop');
    if (line.startsWith('```')) {
      inBlock = armed && !inBlock;
      continue;
    }
    if (inBlock && line !== '') phrases.push(line);
  }
  return phrases;
};

export const detectDraftFindings = (draft: string, phrases: ReadonlyArray<string>): ReadonlyArray<Finding> => {
  const findings: Finding[] = [];
  const lines = draft.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lowered = line.toLowerCase();
    if (line.includes('—')) findings.push({ line: index + 1, kind: 'em-dash', detail: line.trim() });
    if (line.includes('–')) findings.push({ line: index + 1, kind: 'en-dash', detail: line.trim() });
    for (const phrase of phrases) {
      if (lowered.includes(phrase.toLowerCase())) findings.push({ line: index + 1, kind: 'phrase', detail: phrase });
    }
  }
  return findings;
};

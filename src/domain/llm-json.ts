// Lenient JSON recovery for agent replies (SPEC §10): agents are told to emit a raw JSON
// object, but a model may wrap it in a ```json fence or stray prose. Taking the first `{`
// to the last `}` strips both without regexes; genuinely broken JSON stays undefined.
export const extractJsonObject = (text: string): Record<string, unknown> | undefined => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    // No brace-presence guard: a missing/reversed brace pair slices to a string JSON.parse
    // rejects, so the catch already owns every malformed case. A successful parse of a
    // slice that starts at '{' is an object by the JSON grammar - no isRecord re-check.
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** Array intake for LLM-provided fields: keep the strings, drop everything else. */
export const asStringArray = (value: unknown): ReadonlyArray<string> => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

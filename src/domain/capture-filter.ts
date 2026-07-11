// The never-capture list (decision 20, now live): literal terms - names, codenames, domains,
// any language - that must never enter the KB. It lives in the profile dir (never indexed,
// never gardened) and is enforced at BOTH capture sinks: kb-queue append (early, so research
// sees the refusal) and write-kb-page (final, so nothing already queued lands either).
export const NEVER_CAPTURE_PATH = 'data/profile/never-capture.txt';

/** One literal per line; blank lines and # comments ignored; terms are matched as-is. */
export const parseNeverCapture = (content: string): ReadonlyArray<string> =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

/** The first blocked term the text contains (case-insensitive substring - works for any script), or undefined. */
export const findBlockedTerm = (text: string, terms: ReadonlyArray<string>): string | undefined => {
  const haystack = text.toLowerCase();
  return terms.find((term) => haystack.includes(term.toLowerCase()));
};

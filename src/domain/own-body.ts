/**
 * Extract the user's OWN writing from `ask-marcel-office convert-mail-to-markdown`
 * output: strip the metadata header block, cut everything from the first
 * quoted-reply marker (markdown HR, re-emitted From:/De: headers, FR/EN/ZH
 * reply intros), and cut the signature (matched from display name / job title).
 * Ported from the ask-marcel-plugin extractor (provenance: SPEC.md §12),
 * rewritten line-based with string predicates: the original's regex battery
 * bred hundreds of near-equivalent Stryker mutants (see LESSONS.md).
 */

const HEADER_KEYS = ['subject', 'from', 'to', 'cc', 'bcc', 'date', 'sent', 'importance'];

const isHeaderLine = (line: string): boolean => {
  const bare = line.trim().toLowerCase().replaceAll('**', '');
  const colon = bare.indexOf(':');
  if (colon === -1) return false;
  return HEADER_KEYS.includes(bare.slice(0, colon).trim());
};

// '' passes the first check and fails the second, so no empty-guard is needed.
const isUpperCase = (char: string): boolean => char === char.toUpperCase() && char !== char.toLowerCase();

const startsQuotedHeader = (trimmed: string, key: string): boolean => {
  const bare = trimmed.toLowerCase().replaceAll('**', '').replaceAll(' ', '');
  if (!bare.startsWith(`${key}:`)) return false;
  if (trimmed.startsWith('**')) return true;
  const rest = trimmed.slice(trimmed.indexOf(':') + 1).trim();
  return isUpperCase(rest.charAt(0));
};

const isDigits = (text: string): boolean => text !== '' && [...text].every((char) => char >= '0' && char <= '9');

// Localized reply-intro lines: "<prefix> <day> <month> <year> ..." - the day is
// 1-2 digits (German writes "27."), the year four. English requires the comma
// its real intros always carry, to spare sentences like "On May plans" (decision 23).
const DATE_INTRO_PREFIXES: ReadonlyArray<{ readonly prefix: string; readonly comma: boolean }> = [
  { prefix: 'Le ', comma: false },
  { prefix: 'On ', comma: true },
  { prefix: 'Am ', comma: false },
  { prefix: 'El ', comma: false },
  { prefix: 'Il giorno ', comma: false },
  { prefix: 'Em ', comma: false },
  { prefix: 'W dniu ', comma: false },
  { prefix: 'Den ', comma: false },
];

const bareNumber = (word: string): string => word.replaceAll('.', '').replaceAll(',', '');

const isDateIntro = (trimmed: string): boolean => {
  const entry = DATE_INTRO_PREFIXES.find((candidate) => trimmed.startsWith(candidate.prefix));
  if (entry === undefined || (entry.comma && !trimmed.includes(','))) return false;
  const words = trimmed.split(' ').filter((word) => word !== '');
  const hasDay = words.some((word) => isDigits(bareNumber(word)) && bareNumber(word).length <= 2);
  const hasYear = words.some((word) => isDigits(bareNumber(word)) && bareNumber(word).length === 4);
  return hasDay && hasYear;
};

// Localized quoted-header tokens. Latin ones go through startsQuotedHeader
// (colon + bold-or-capital guard); the exact-prefix ones match with ':' or '：'.
const LATIN_HEADER_TOKENS = ['from', 'de', 'von', 'da', 'van', 'от'];
const EXACT_HEADER_TOKENS = ['发件人', '寄件者', '差出人', '보낸 사람'];

const isHorizontalRule = (trimmed: string): boolean => {
  const squeezed = trimmed.split(' ').filter((part) => part !== '');
  if (squeezed.length === 3 && squeezed.every((part) => part === '*')) return true;
  if (trimmed.length >= 8 && [...trimmed].every((char) => char === '_')) return true;
  return trimmed.length >= 3 && [...trimmed].every((char) => char === '-');
};

const isQuotedReplyCut = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (isHorizontalRule(trimmed)) return true;
  if (trimmed.startsWith('-----Original Message-----')) return true;
  if (trimmed.startsWith('> Le ')) return true;
  if (isDateIntro(trimmed)) return true;
  if (LATIN_HEADER_TOKENS.some((token) => startsQuotedHeader(trimmed, token))) return true;
  return EXACT_HEADER_TOKENS.some((token) => trimmed.startsWith(`${token}:`) || trimmed.startsWith(`${token}：`));
};

const signatureMarkers = (displayName: string, jobTitlePrefix: string): ReadonlyArray<(trimmed: string) => boolean> => [
  ...(displayName === '' ? [] : [(trimmed: string): boolean => trimmed === `**_${displayName}_**`]),
  ...(jobTitlePrefix === '' ? [] : [(trimmed: string): boolean => trimmed.startsWith(`_${jobTitlePrefix}`)]),
];

const stripHeaderBlock = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  let index = 0;
  while (index < lines.length && (lines[index].trim() === '' || isHeaderLine(lines[index]))) index += 1;
  return lines.slice(index);
};

const dropCidImages = (line: string): string => {
  let cleaned = line;
  for (let start = cleaned.indexOf('![](cid:'); start !== -1; start = cleaned.indexOf('![](cid:')) {
    const end = cleaned.indexOf(')', start);
    if (end === -1) return cleaned.slice(0, start);
    cleaned = cleaned.slice(0, start) + cleaned.slice(end + 1);
  }
  return cleaned;
};

const tidy = (lines: ReadonlyArray<string>): string => {
  const kept: string[] = [];
  let inTable = false;
  for (const raw of lines) {
    const line = dropCidImages(raw).trimEnd();
    if (line.trimStart().startsWith('<table')) inTable = true;
    if (inTable) {
      if (line.includes('</table>')) inTable = false;
      continue;
    }
    if (line.trim() === '' && kept[kept.length - 1]?.trim() === '') continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
};

const cutAt = (lines: ReadonlyArray<string>, extraMarkers: ReadonlyArray<(trimmed: string) => boolean>): number => {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (isQuotedReplyCut(lines[index]) || extraMarkers.some((marker) => marker(trimmed))) return index;
  }
  return lines.length;
};

export const extractOwnBody = (markdown: string, displayName = '', jobTitlePrefix = ''): string => {
  const body = stripHeaderBlock(markdown.split('\n'));
  return tidy(body.slice(0, cutAt(body, signatureMarkers(displayName, jobTitlePrefix))));
};

const stripInlineMarkup = (line: string): string => {
  let text = line.replaceAll('**', '').replaceAll('__', '');
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('_') && trimmed.endsWith('_')) text = trimmed.slice(1, -1);
  // The two remaining regexes are bounded and single-purpose: markdown links and stray tags.
  return text.replace(/\[([^\]]{1,256})\]\(([^)]{1,512})\)/g, '$1 ($2)').replace(/<[^>]{1,256}>/g, '');
};

/** The signature block: from its marker (bold-italic name / job-title line) to the quoted chain. "" when no marker hits. */
export const extractSignature = (markdown: string, displayName = '', jobTitlePrefix = ''): string => {
  const markers = signatureMarkers(displayName, jobTitlePrefix);
  if (markers.length === 0) return '';
  const body = stripHeaderBlock(markdown.split('\n'));
  const start = cutAt(body, markers);
  if (start === body.length || !markers.some((marker) => marker(body[start].trim()))) return '';
  const signature = body.slice(start);
  const end = cutAt(signature.slice(1), []) + 1;
  return signature
    .slice(0, end)
    .map((line) => dropCidImages(stripInlineMarkup(line)).trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim();
};

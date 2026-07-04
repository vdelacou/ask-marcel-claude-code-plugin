/**
 * KB filename slug (SPEC.md §8b, decision 23): diacritics stripped, any
 * script's letters and digits kept (CJK names stay CJK), everything else
 * collapsed to dashes. A name with no usable characters falls back to a
 * deterministic hash so no page ever gets an empty path.
 * Only single-character regex classes - provably linear (sonarjs/super-linear-regex).
 */

const hash8 = (text: string): string => {
  let hash = 5381;
  for (const char of text) hash = (hash * 33 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

export const toSlug = (name: string): string => {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '-')
    .split('-')
    .filter((part) => part !== '')
    .join('-')
    // NFD leaves Hangul decomposed into jamo - recompose so 김철수 stays 김철수.
    .normalize('NFC');
  return slug === '' ? `x-${hash8(name)}` : slug;
};

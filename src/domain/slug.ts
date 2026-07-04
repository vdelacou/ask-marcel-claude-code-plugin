/**
 * ASCII kebab slug for KB filenames (SPEC.md §8b): diacritics stripped,
 * anything non-alphanumeric becomes a dash, runs collapsed, no edge dashes.
 * Only single-character regex classes — provably linear (sonarjs/super-linear-regex).
 */
export const toSlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .split('-')
    .filter((part) => part !== '')
    .join('-');

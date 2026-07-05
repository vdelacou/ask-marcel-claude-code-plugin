/**
 * A Graph message id becomes a path segment under data/scratch/<run>/<id>/ —
 * a filesystem sink (rule 12). This normaliser is the checkpoint: every
 * character outside the base64url-plus-padding alphabet collapses to a dash,
 * so `/`, `+`, spaces, and `..` sequences can neither nest a directory nor
 * traverse out of the bundle root. Total by construction, mirroring toSlug.
 * Single-character class keeps it provably linear (sonarjs/super-linear-regex).
 */

const SAFE_SEGMENT_CHAR = /[A-Za-z0-9_=-]/;

export const emailIdSegment = (rawId: string): string => [...rawId].map((char) => (SAFE_SEGMENT_CHAR.test(char) ? char : '-')).join('');

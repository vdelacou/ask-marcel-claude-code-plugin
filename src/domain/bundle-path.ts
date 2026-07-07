/**
 * A Graph message id becomes a path segment under data/scratch/<run>/<id>/ —
 * a filesystem sink (rule 12). This normaliser is the checkpoint: every
 * character outside the base64url-plus-padding alphabet collapses to a dash,
 * so `/`, `+`, spaces, and `..` sequences can neither nest a directory nor
 * traverse out of the bundle root. Total by construction, mirroring toSlug.
 * Single-character class keeps it provably linear (sonarjs/super-linear-regex).
 *
 * A real immutable id runs ~150-200 chars; used raw it pushes the deep bundle
 * path past Windows' 260-char MAX_PATH (ENAMETOOLONG). So anything over the cap
 * collapses to `<prefix>-<hash>`: the hash is FNV-1a over the WHOLE raw id (not
 * the truncated prefix), so two ids sharing a long prefix never collide. It is a
 * hand-rolled hash — deterministic and version-stable, unlike a native digest —
 * so a resumed run recomputes the identical segment and still finds its bundle.
 */

const SAFE_SEGMENT_CHAR = /[A-Za-z0-9_=-]/;
const MAX_SEGMENT = 32;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const fnv1a = (input: string): string => [...input].reduce((hash, char) => Math.imul(hash ^ (char.codePointAt(0) ?? 0), FNV_PRIME) >>> 0, FNV_OFFSET).toString(36);

export const emailIdSegment = (rawId: string): string => {
  const safe = [...rawId].map((char) => (SAFE_SEGMENT_CHAR.test(char) ? char : '-')).join('');
  return safe.length <= MAX_SEGMENT ? safe : `${safe.slice(0, MAX_SEGMENT)}-${fnv1a(rawId)}`;
};

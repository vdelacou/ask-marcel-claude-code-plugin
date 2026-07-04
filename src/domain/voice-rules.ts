export type Bucket = 'upward' | 'peers' | 'external' | 'broadcast';

export type OrgContext = {
  readonly ownDomains: ReadonlyArray<string>;
  readonly managerEmails: ReadonlyArray<string>;
};

const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/**
 * One-line acks teach nothing about voice; the corpus keeps messages of 15+
 * words - or 25+ CJK characters, since Chinese/Japanese/Korean text has no
 * word spaces (SPEC.md §9, decision 23).
 */
export const isSubstantive = (ownBody: string): boolean => {
  const words = ownBody.split(/\s+/).filter((word) => word !== '').length;
  const cjk = [...ownBody].filter((char) => CJK_CHAR.test(char)).length;
  return words >= 15 || cjk >= 25;
};

const domainOf = (email: string): string => email.slice(email.indexOf('@') + 1).toLowerCase();

/**
 * Bucket a sent message by its recipients (SPEC.md §9): upward wins over
 * everything, then broadcast (>5 recipients), then external (any To-line
 * recipient outside the internal domains), else peers.
 */
export const bucketFor = (to: ReadonlyArray<string>, cc: ReadonlyArray<string>, org: OrgContext): Bucket => {
  const everyone = [...to, ...cc].map((email) => email.toLowerCase());
  if (org.managerEmails.some((manager) => everyone.includes(manager.toLowerCase()))) return 'upward';
  if (everyone.length > 5) return 'broadcast';
  if (to.map(domainOf).some((domain) => !org.ownDomains.includes(domain))) return 'external';
  return 'peers';
};

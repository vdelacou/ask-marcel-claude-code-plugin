export type Bucket = 'upward' | 'peers' | 'external' | 'broadcast';

export type OrgContext = {
  readonly ownDomains: ReadonlyArray<string>;
  readonly managerEmails: ReadonlyArray<string>;
};

/** One-line acks teach nothing about voice; the corpus keeps messages of 15+ words (SPEC.md §9). */
export const isSubstantive = (ownBody: string): boolean => ownBody.split(/\s+/).filter((word) => word !== '').length >= 15;

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

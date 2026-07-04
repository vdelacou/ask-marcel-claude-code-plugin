import type { KbFile } from './okf-kb.ts';
import { toSlug } from './slug.ts';

export type PersonSeed = {
  readonly displayName: string;
  readonly emails: ReadonlyArray<string>;
  readonly title?: string;
  readonly company?: string;
  readonly department?: string;
};

const personDescription = (seed: PersonSeed): string => {
  if (seed.title !== undefined && seed.company !== undefined) return `${seed.title} @ ${seed.company}`;
  return seed.title ?? seed.company ?? 'Contact seeded from the directory';
};

export const personPage = (seed: PersonSeed, todayIso: string): KbFile => ({
  path: `data/kb/people/${toSlug(seed.displayName)}.md`,
  content: [
    '---',
    'type: person',
    `title: ${seed.displayName}`,
    `description: ${personDescription(seed)}`,
    'emails:',
    ...seed.emails.map((email) => `  - ${email}`),
    ...(seed.company === undefined ? [] : [`org: /orgs/${toSlug(seed.company)}.md`]),
    ...(seed.department === undefined ? [] : [`department: ${seed.department}`]),
    'tags:',
    '  - seed',
    `timestamp: ${todayIso}`,
    '---',
    '',
    `# ${seed.displayName}`,
    '',
    '## Commitments',
    '',
    '_None recorded yet._',
    '',
  ].join('\n'),
});

import type { KbFile } from './okf-kb.ts';
import { toSlug } from './slug.ts';

export type OrgSeed = {
  readonly name: string;
  readonly domains: ReadonlyArray<string>;
  readonly internal: boolean;
};

export const orgPage = (seed: OrgSeed, todayIso: string): KbFile => ({
  path: `data/kb/orgs/${toSlug(seed.name)}.md`,
  content: [
    '---',
    'type: organization',
    `title: ${seed.name}`,
    `description: ${seed.internal ? 'Internal organization' : 'External organization'}`,
    'domains:',
    ...seed.domains.map((domain) => `  - ${domain}`),
    `relationship: ${seed.internal ? 'internal' : 'external'}`,
    'tags:',
    '  - seed',
    `timestamp: ${todayIso}`,
    '---',
    '',
    `# ${seed.name}`,
    '',
    '## Key people',
    '',
    '_None linked yet._',
    '',
  ].join('\n'),
});

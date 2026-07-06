import { KB_ROOT } from './okf-kb.ts';

// A vetted KB page from kb-curator (SPEC §4/§8): the structured fields become an OKF page.
export type KbPageInput = {
  readonly folder: string;
  readonly slug: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly resource?: string;
  readonly tags: ReadonlyArray<string>;
  readonly content: string;
  readonly citations: ReadonlyArray<string>;
};

export const kbPagePath = (folder: string, slug: string): string => `${KB_ROOT}/${folder}/${slug}.md`;

const frontmatter = (input: KbPageInput, todayIso: string): ReadonlyArray<string> => [
  '---',
  `type: ${input.type}`,
  `title: ${input.title}`,
  `description: ${input.description}`,
  ...(input.resource === undefined || input.resource === '' ? [] : [`resource: ${input.resource}`]),
  'tags:',
  ...input.tags.map((tag) => `  - ${tag}`),
  `timestamp: ${todayIso}`,
  '---',
];

const citationsBlock = (citations: ReadonlyArray<string>): ReadonlyArray<string> =>
  citations.length === 0 ? [] : ['', '# Citations', '', ...citations.map((citation, index) => `[${index + 1}] ${citation}`)];

export const renderOkfPage = (input: KbPageInput, todayIso: string): string =>
  [...frontmatter(input, todayIso), '', `# ${input.title}`, '', input.content, ...citationsBlock(input.citations), ''].join('\n');

// An existing page is never overwritten: new content lands under a dated Update section (SPEC §8 add-to-KB rule).
export const mergeUpdate = (existing: string, content: string, todayIso: string): string => `${existing.trimEnd()}\n\n## Update ${todayIso}\n\n${content}\n`;

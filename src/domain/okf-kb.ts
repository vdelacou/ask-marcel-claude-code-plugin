export type KbFile = { readonly path: string; readonly content: string };

export const KB_ROOT = 'data/kb';

export type KbFolder = { readonly name: string; readonly title: string; readonly blurb: string };

export const KB_FOLDERS: ReadonlyArray<KbFolder> = [
  { name: 'people', title: 'People', blurb: 'one page per person: identity, org links, commitments.' },
  { name: 'orgs', title: 'Orgs', blurb: 'organizations and teams: domains, relationships, key people.' },
  { name: 'projects', title: 'Projects', blurb: 'active projects and their state.' },
  { name: 'topics', title: 'Topics', blurb: 'topical knowledge that spans projects.' },
  { name: 'decisions', title: 'Decisions', blurb: 'dated decisions with their context.' },
  { name: 'meetings', title: 'Meetings', blurb: 'recurring meeting series.' },
  { name: 'jargon', title: 'Jargon', blurb: 'abbreviations and codenames, always loaded.' },
];

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const rootIndex = (): string =>
  [
    '---',
    'okf_version: "0.1"',
    '---',
    '',
    '# Knowledge Base',
    '',
    'Open Knowledge Format bundle for the inbox-zero reply plugin (SPEC.md §8).',
    '',
    ...KB_FOLDERS.map((folder) => `- [${folder.title}](/${folder.name}/index.md) - ${folder.blurb}`),
    '',
  ].join('\n');

const logSeed = (todayIso: string): string => ['# Log', '', `## ${todayIso}`, '', '- kb-init: created the OKF skeleton', ''].join('\n');

const folderIndex = (folder: KbFolder): string => [`# ${folder.title}`, '', sentence(folder.blurb), '', '_No pages yet._', ''].join('\n');

const abbreviationsSeed = (todayIso: string): string =>
  [
    '---',
    'type: jargon',
    'title: Abbreviations',
    "description: Abbreviations, acronyms, and codenames from the user's mail - always loaded before any run.",
    'tags:',
    '  - jargon',
    `timestamp: ${todayIso}`,
    '---',
    '',
    '# Abbreviations',
    '',
    '_None captured yet. The wrap-up phase of every run proposes new entries here._',
    '',
  ].join('\n');

export const kbSkeleton = (todayIso: string): ReadonlyArray<KbFile> => [
  { path: `${KB_ROOT}/index.md`, content: rootIndex() },
  { path: `${KB_ROOT}/log.md`, content: logSeed(todayIso) },
  ...KB_FOLDERS.map((folder) => ({ path: `${KB_ROOT}/${folder.name}/index.md`, content: folderIndex(folder) })),
  { path: `${KB_ROOT}/jargon/abbreviations.md`, content: abbreviationsSeed(todayIso) },
];

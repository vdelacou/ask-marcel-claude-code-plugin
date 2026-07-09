export type KbFile = { readonly path: string; readonly content: string };

export const KB_ROOT = 'data/kb';

// Bun.Glob returns OS-native separators: forward slashes on POSIX, backslashes on
// Windows (verified). Every path operation on a listed KB file must therefore split
// on BOTH separators — a bare `endsWith('/index.md')` or `lastIndexOf('/')` silently
// misclassifies `data\kb\people\index.md` on Windows, which is how index.md ended up
// self-listed (issue #6) and flagged as no-frontmatter (issue #5), and how every
// generated link pointed at a full backslash path instead of a slug.
const basenameOf = (path: string): string => {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash === -1 ? path : path.slice(slash + 1);
};

/** Last path segment, OS-separator-agnostic — `data\kb\people\marc.md` -> `marc.md`. */
export const kbBasename = basenameOf;

/** The slug a concept page is keyed by: basename minus the `.md` suffix. */
export const kbSlugOf = (path: string): string => {
  const base = basenameOf(path);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

// index.md (folder root) and log.md (run log) are reserved / generated files, not
// concept pages — they carry no OKF frontmatter and must be excluded from both the
// generated page listing and the lint pass. Separator-agnostic so it holds on Windows.
export const isReservedKbFile = (path: string): boolean => {
  const base = basenameOf(path);
  return base === 'index.md' || base === 'log.md';
};

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

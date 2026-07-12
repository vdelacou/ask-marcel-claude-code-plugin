// The runnable login command for THIS install (dev checkout or plugin cache). Error remedies
// are consumed by an agent whose cwd is the user's project, not the plugin root — a relative
// `bun scripts/login.ts` would not resolve there, so the remedy carries the absolute path.
export const loginCommand = (): string => `bun "${Bun.fileURLToPath(new URL('../../scripts/login.ts', import.meta.url))}"`;

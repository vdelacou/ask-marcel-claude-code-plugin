// Where data/ (KB, profile, mail scratch) lives, independent of the folder the plugin is launched
// from (SPEC.md v0.1 baseDir). Defaults to the plugin's own root; ASK_MARCEL_HOME overrides it —
// needed once the plugin is installed from the ephemeral ~/.claude/plugins/cache, whose root is not
// a stable data home. Every script entry chdir's here before it touches any data/ path.
export const resolveDataHome = (env: Readonly<Record<string, string | undefined>>, pluginRoot: string): string => {
  const home = env['ASK_MARCEL_HOME'];
  return home === undefined || home === '' ? pluginRoot : home;
};

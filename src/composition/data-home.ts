// Where data/ (KB, profile, mail scratch) lives. By default this is the caller's current working
// directory (the folder Claude Code was launched from), so KB/profile/scratch live alongside where
// you run the plugin, not in the ephemeral ~/.claude/plugins/cache. ASK_MARCEL_HOME overrides it with
// a fixed path. Every script entry chdir's to the result before it touches any data/ path.
export const resolveDataHome = (env: Readonly<Record<string, string | undefined>>, fallback: string): string => {
  const home = env['ASK_MARCEL_HOME'];
  return home === undefined || home === '' ? fallback : home;
};

/**
 * Append entries to the reserved OKF log.md: date-grouped, newest first —
 * today's section is created at the top when absent, and new entries land
 * at the top of an existing today-section.
 */
export const appendLogEntries = (existing: string, todayIso: string, entries: ReadonlyArray<string>): string => {
  const lines = entries.map((entry) => `- ${entry}`).join('\n');
  const heading = `## ${todayIso}`;
  if (existing.includes(`${heading}\n\n`)) return existing.replace(`${heading}\n\n`, `${heading}\n\n${lines}\n`);
  if (existing.includes('# Log\n\n')) return existing.replace('# Log\n\n', `# Log\n\n${heading}\n\n${lines}\n\n`);
  return `# Log\n\n${heading}\n\n${lines}\n`;
};

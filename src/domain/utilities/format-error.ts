/*
 * Format an unknown thrown value into a human-readable string.
 *
 * Replaces `String(err)` in catch blocks. `String(obj)` returns
 * "[object Object]" for plain-object throws and loses the message
 * entirely (SonarJS S6551).
 *
 * Use this in EVERY `catch (e)` block in src/infra/** and in any
 * pure-domain native-API fallback. Safe on any input.
 *
 * See skills/atelier/references/workflow.md (SonarJS table, S6551).
 */

export const formatError = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  // Diverges from the atelier asset: the boolean clause was dropped because
  // JSON.stringify(true) === String(true) — an equivalent mutant under Stryker.
  // Numbers stay: String(NaN) is 'NaN' while JSON.stringify(NaN) is 'null'.
  if (typeof err === 'number') return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return '[unstringifiable error]';
  }
};

import { asString } from './graph-envelopes.ts';
import { asStringArray, extractJsonObject } from './llm-json.ts';

// The triage-scout contract (SPEC §2 Phase 2, §10 golden fixtures): five keys, strict JSON.
// Parsing is deterministic code, not skill judgment - fences and stray keys are tolerated,
// but a verdict without an id and a boolean needs_reply is garbage the skill must retry.
export type ScoutUrgency = 'high' | 'medium' | 'low';

export type ScoutVerdict = {
  readonly id: string;
  readonly needs_reply: boolean;
  readonly urgency: ScoutUrgency;
  readonly reason: string;
  readonly kb_refs: ReadonlyArray<string>;
};

// A malformed urgency degrades to low rather than killing the verdict: the id + needs_reply
// carry the decision; urgency only orders the table.
const asUrgency = (value: unknown): ScoutUrgency => (value === 'high' || value === 'medium' || value === 'low' ? value : 'low');

export const parseScoutVerdict = (text: string): ScoutVerdict | undefined => {
  const record = extractJsonObject(text);
  if (record === undefined) return undefined;
  // asString('') is undefined (it treats empty as absent), so one check covers both.
  const id = asString(record['id']);
  const needsReply = record['needs_reply'];
  if (id === undefined || typeof needsReply !== 'boolean') return undefined;
  return { id, needs_reply: needsReply, urgency: asUrgency(record['urgency']), reason: asString(record['reason']) ?? '', kb_refs: asStringArray(record['kb_refs']) };
};

/** Scout replies are bundled into one scratch file, one reply per scissors line. */
export const VERDICT_SEPARATOR = '-----8<-----';

export type ParsedVerdicts = { readonly verdicts: ReadonlyArray<ScoutVerdict>; readonly garbage: ReadonlyArray<number> };

// Split a bundle on scissors lines and parse each chunk. `garbage` carries the 0-based
// position of each unparseable chunk so the skill knows WHICH scout to retry; chunks that
// are pure whitespace are ignored entirely (trailing separators cost nothing).
export const parseScoutVerdicts = (bundle: string): ParsedVerdicts => {
  const chunks = bundle.split(VERDICT_SEPARATOR).filter((chunk) => chunk.trim() !== '');
  const verdicts: ScoutVerdict[] = [];
  const garbage: number[] = [];
  chunks.forEach((chunk, index) => {
    const verdict = parseScoutVerdict(chunk);
    if (verdict === undefined) garbage.push(index);
    else verdicts.push(verdict);
  });
  return { verdicts, garbage };
};

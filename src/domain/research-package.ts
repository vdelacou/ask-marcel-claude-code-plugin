import { asString, isRecord } from './graph-envelopes.ts';
import { extractJsonObject } from './llm-json.ts';

// The email-researcher package contract (SPEC §2 Phase 3, §10 "package shapes"): the shape
// checks are deterministic code so a drifting prompt is caught the moment a package returns,
// not three gates later. Problems are precise sentences the skill can hand back to a retried
// researcher; an empty list means the package holds.

const CITATION_CONFIDENCE = 70;

const STRATEGY_COUNT = 3;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const named = (label: string, index: number): string => `${label}[${index}]`;

const questionProblems = (value: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(value)) return ['questions must be an array'];
  return value.flatMap((question, index) => {
    if (!isRecord(question)) return [`${named('questions', index)} must be an object`];
    const problems: string[] = [];
    if (!isNonEmptyString(question['q'])) problems.push(`${named('questions', index)}.q is missing or empty`);
    const confidence = question['confidence'];
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 100) problems.push(`${named('questions', index)}.confidence must be a number 0-100`);
    const citations = Array.isArray(question['citations']) ? question['citations'].filter((c): c is string => isNonEmptyString(c)) : [];
    if (typeof confidence === 'number' && confidence >= CITATION_CONFIDENCE && citations.length === 0) {
      problems.push(`${named('questions', index)} claims confidence ${confidence} with no citation - never answer from a snippet alone`);
    }
    return problems;
  });
};

const strategyProblems = (value: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(value) || value.length !== STRATEGY_COUNT) return [`strategies must be exactly ${STRATEGY_COUNT} genuinely different stances`];
  const problems: string[] = [];
  const names = new Set<string>();
  value.forEach((strategy, index) => {
    if (!isRecord(strategy)) {
      problems.push(`${named('strategies', index)} must be an object`);
      return;
    }
    for (const field of ['name', 'rationale', 'skeleton']) {
      if (!isNonEmptyString(strategy[field])) problems.push(`${named('strategies', index)}.${field} is missing or empty`);
    }
    const name = asString(strategy['name'])?.toLowerCase() ?? '';
    if (name !== '' && names.has(name)) problems.push(`${named('strategies', index)}.name duplicates another strategy - stances must differ`);
    names.add(name);
  });
  return problems;
};

const recipientProblems = (value: unknown): ReadonlyArray<string> => {
  if (!isRecord(value)) return ['recipients must be an object with to[] and cc[]'];
  const to = Array.isArray(value['to']) ? value['to'].filter((address): address is string => isNonEmptyString(address)) : [];
  return to.length === 0 ? ['recipients.to must name at least one address'] : [];
};

/** Every violated shape rule, as precise sentences; an empty list means the package holds. */
export const validateResearchPackage = (record: Record<string, unknown>): ReadonlyArray<string> => [
  ...(isNonEmptyString(record['emailId']) ? [] : ['emailId is missing or empty']),
  ...(isNonEmptyString(record['conversationId']) ? [] : ['conversationId is missing or empty']),
  ...(isNonEmptyString(record['context']) ? [] : ['context is missing or empty']),
  ...questionProblems(record['questions']),
  ...strategyProblems(record['strategies']),
  ...recipientProblems(record['recipients']),
];

export type PackageCheck = { readonly record?: Record<string, unknown>; readonly problems: ReadonlyArray<string> };

/** Lenient extraction (fences/prose tolerated) + shape validation in one step. */
export const checkResearchPackage = (text: string): PackageCheck => {
  const record = extractJsonObject(text);
  if (record === undefined) return { problems: ['the reply holds no parseable JSON object'] };
  const problems = validateResearchPackage(record);
  return problems.length === 0 ? { record, problems: [] } : { problems };
};

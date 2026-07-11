import { describe, expect, test } from 'bun:test';

import { checkResearchPackage, validateResearchPackage } from './research-package.ts';

// The golden package (SPEC §10): every required field, three distinct stances, cited answers.
const GOLDEN = {
  emailId: 'AAMkAGE1',
  conversationId: 'conv-1',
  context: 'Jane asks whether the Q3 envelope can absorb the vendor overrun.',
  timeline: [{ date: '2026-07-10', from: 'jane@internal-corp.com', gist: 'asks for confirmation' }],
  questions: [
    { q: 'What is the approved Q3 envelope?', answer: '120k, confirmed in the budget page', confidence: 85, citations: ['qmd://ask-marcel-kb/topics/q3-budget.md'] },
    { q: 'Did we commit a date to the vendor?', answer: 'nothing found', confidence: 30, citations: [] },
  ],
  gaps: ['vendor contract not reachable'],
  contradictions: [],
  jargon_candidates: [{ term: 'OB', guessed_meaning: 'onboarding', context: 'thread subject' }],
  strategies: [
    { name: 'commit', rationale: 'the envelope covers it', skeleton: 'Confirm 120k and the timeline.' },
    { name: 'clarify', rationale: 'the overrun size is unstated', skeleton: 'Ask for the exact overrun first.' },
    { name: 'redirect', rationale: 'finance owns the envelope', skeleton: 'Route to finance with context.' },
  ],
  recipients: { to: ['jane@internal-corp.com'], cc: [] },
};

describe('validateResearchPackage (golden fixtures - SPEC §10)', () => {
  test('the golden package holds: zero problems, record returned', () => {
    expect(validateResearchPackage(GOLDEN)).toEqual([]);
    expect(checkResearchPackage(`\`\`\`json\n${JSON.stringify(GOLDEN)}\n\`\`\``)).toEqual({ record: GOLDEN, problems: [] });
  });

  test('every missing identity field is named precisely', () => {
    expect(validateResearchPackage({ ...GOLDEN, emailId: '', conversationId: undefined, context: '   ' })).toEqual([
      'emailId is missing or empty',
      'conversationId is missing or empty',
      'context is missing or empty',
    ]);
  });

  test('a high-confidence answer without a citation is refused - never answer from a snippet alone', () => {
    const uncited = { ...GOLDEN, questions: [{ q: 'What is the envelope?', answer: '120k', confidence: 70, citations: [] }] };
    expect(validateResearchPackage(uncited)).toEqual(['questions[0] claims confidence 70 with no citation - never answer from a snippet alone']);

    // one point below the threshold, the same empty citations are fine
    const belowThreshold = { ...GOLDEN, questions: [{ q: 'What is the envelope?', answer: 'unclear', confidence: 69, citations: [] }] };
    expect(validateResearchPackage(belowThreshold)).toEqual([]);
  });

  test('confidence bounds and question shape are pinned', () => {
    const bad = { ...GOLDEN, questions: [{ q: '', answer: 'x', confidence: 140, citations: ['c'] }, 'not an object'] };
    expect(validateResearchPackage(bad)).toEqual(['questions[0].q is missing or empty', 'questions[0].confidence must be a number 0-100', 'questions[1] must be an object']);
    expect(validateResearchPackage({ ...GOLDEN, questions: 'none' })).toEqual(['questions must be an array']);

    // exact bounds are valid; negatives and non-numbers are one precise problem each
    const q = (confidence: unknown, citations: unknown = ['c']): unknown => ({ ...GOLDEN, questions: [{ q: 'x', answer: 'y', confidence, citations }] });
    expect(validateResearchPackage(q(0, []) as Record<string, unknown>)).toEqual([]);
    expect(validateResearchPackage(q(100) as Record<string, unknown>)).toEqual([]);
    expect(validateResearchPackage(q(-5, []) as Record<string, unknown>)).toEqual(['questions[0].confidence must be a number 0-100']);
    // a non-number confidence never triggers the citation rule on top of the bounds problem
    expect(validateResearchPackage(q('high', []) as Record<string, unknown>)).toEqual(['questions[0].confidence must be a number 0-100']);
    // garbage citations do not count as citations at high confidence
    expect(validateResearchPackage(q(85, [42]) as Record<string, unknown>)).toEqual(['questions[0] claims confidence 85 with no citation - never answer from a snippet alone']);
    expect(validateResearchPackage(q(85, 'nope') as Record<string, unknown>)).toEqual(['questions[0] claims confidence 85 with no citation - never answer from a snippet alone']);
  });

  test('exactly three genuinely different stances: count, fields, and duplicate names are all caught', () => {
    expect(validateResearchPackage({ ...GOLDEN, strategies: GOLDEN.strategies.slice(0, 2) })).toEqual(['strategies must be exactly 3 genuinely different stances']);

    const dupes = {
      ...GOLDEN,
      strategies: [GOLDEN.strategies[0], { name: 'COMMIT', rationale: 'same stance again', skeleton: 'x' }, { name: 'clarify', rationale: '', skeleton: 'y' }],
    };
    expect(validateResearchPackage(dupes)).toEqual(['strategies[1].name duplicates another strategy - stances must differ', 'strategies[2].rationale is missing or empty']);

    const notAnObject = { ...GOLDEN, strategies: ['just a string', GOLDEN.strategies[1], GOLDEN.strategies[2]] };
    expect(validateResearchPackage(notAnObject)).toEqual(['strategies[0] must be an object']);

    // a non-string name is a missing-name problem, never a crash and never a duplicate
    const numericName = { ...GOLDEN, strategies: [{ name: 42, rationale: 'r', skeleton: 's' }, GOLDEN.strategies[1], GOLDEN.strategies[2]] };
    expect(validateResearchPackage(numericName)).toEqual(['strategies[0].name is missing or empty']);

    // two nameless strategies are two missing-name problems - the duplicate rule ignores empties
    const twoNameless = { ...GOLDEN, strategies: [{ name: '', rationale: 'r', skeleton: 's' }, { name: '', rationale: 'r2', skeleton: 's2' }, GOLDEN.strategies[2]] };
    expect(validateResearchPackage(twoNameless)).toEqual(['strategies[0].name is missing or empty', 'strategies[1].name is missing or empty']);
  });

  test('recipients must carry at least one to-address', () => {
    expect(validateResearchPackage({ ...GOLDEN, recipients: { to: [], cc: ['x@y.com'] } })).toEqual(['recipients.to must name at least one address']);
    expect(validateResearchPackage({ ...GOLDEN, recipients: 'jane' })).toEqual(['recipients must be an object with to[] and cc[]']);
    // garbage in to[] does not count as an address, and a non-array to is empty
    expect(validateResearchPackage({ ...GOLDEN, recipients: { to: [42], cc: [] } })).toEqual(['recipients.to must name at least one address']);
    expect(validateResearchPackage({ ...GOLDEN, recipients: { to: 'jane@x.com', cc: [] } })).toEqual(['recipients.to must name at least one address']);
  });

  test('checkResearchPackage returns problems without a record when the shape fails', () => {
    const twoStrategies = { ...GOLDEN, strategies: GOLDEN.strategies.slice(0, 2) };
    expect(checkResearchPackage(JSON.stringify(twoStrategies))).toEqual({ problems: ['strategies must be exactly 3 genuinely different stances'] });
  });

  test('a reply with no JSON at all is one precise problem', () => {
    expect(checkResearchPackage('I could not research this email.')).toEqual({ problems: ['the reply holds no parseable JSON object'] });
  });
});

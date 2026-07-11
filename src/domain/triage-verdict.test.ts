import { describe, expect, test } from 'bun:test';

import { parseScoutVerdict, parseScoutVerdicts, VERDICT_SEPARATOR } from './triage-verdict.ts';

const GOLDEN = { id: 'AAMkAGE1', needs_reply: true, urgency: 'medium', reason: 'asks for the Q3 envelope', kb_refs: ['qmd://ask-marcel-kb/people/jane-boss.md'] } as const;

describe('parseScoutVerdict (golden fixtures - SPEC §10)', () => {
  test('a clean scout verdict round-trips field-for-field', () => {
    expect(parseScoutVerdict(JSON.stringify(GOLDEN))).toEqual(GOLDEN);
  });

  test('a fenced verdict with stray keys and prose still parses - stray keys dropped, five keys kept', () => {
    const sloppy = ['The thread clearly needs a reply.', '```json', JSON.stringify({ ...GOLDEN, confidence: 0.9, note: 'extra' }), '```'].join('\n');
    expect(parseScoutVerdict(sloppy)).toEqual(GOLDEN);
  });

  test('defaults degrade gracefully: bad urgency -> low, missing reason -> empty, non-string kb_refs dropped', () => {
    expect(parseScoutVerdict(JSON.stringify({ id: 'm1', needs_reply: false, urgency: 'ASAP', kb_refs: ['ok', 42] }))).toEqual({
      id: 'm1',
      needs_reply: false,
      urgency: 'low',
      reason: '',
      kb_refs: ['ok'],
    });
  });

  test('all three urgencies survive as-is - only garbage degrades to low', () => {
    expect(parseScoutVerdict(JSON.stringify({ ...GOLDEN, urgency: 'high' }))?.urgency).toBe('high');
    expect(parseScoutVerdict(JSON.stringify({ ...GOLDEN, urgency: 'low' }))?.urgency).toBe('low');
  });

  test('a reason in any language survives verbatim', () => {
    const verdict = parseScoutVerdict(JSON.stringify({ ...GOLDEN, reason: '王伟在等预算批复' }));
    expect(verdict?.reason).toBe('王伟在等预算批复');
  });

  test('garbage is garbage: no id, empty id, non-boolean needs_reply, or unparseable text', () => {
    expect(parseScoutVerdict(JSON.stringify({ needs_reply: true }))).toBeUndefined();
    expect(parseScoutVerdict(JSON.stringify({ id: '', needs_reply: true }))).toBeUndefined();
    expect(parseScoutVerdict(JSON.stringify({ id: 'm1', needs_reply: 'yes' }))).toBeUndefined();
    expect(parseScoutVerdict('the scout rambled with no JSON at all')).toBeUndefined();
  });
});

describe('parseScoutVerdicts (bundle)', () => {
  test('a bundle of replies parses in order and names the position of each garbage chunk', () => {
    const bundle = [JSON.stringify(GOLDEN), 'utter nonsense from scout two', JSON.stringify({ id: 'm3', needs_reply: false }), ''].join(`\n${VERDICT_SEPARATOR}\n`);

    const { verdicts, garbage } = parseScoutVerdicts(bundle);

    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toEqual(GOLDEN);
    expect(verdicts[1]).toMatchObject({ id: 'm3', needs_reply: false, urgency: 'low' });
    // chunk 1 (0-based) is the one to retry; the trailing empty chunk is ignored, not garbage
    expect(garbage).toEqual([1]);
  });

  test('an empty bundle yields nothing to parse and nothing to retry', () => {
    expect(parseScoutVerdicts('')).toEqual({ verdicts: [], garbage: [] });
    expect(parseScoutVerdicts(`\n${VERDICT_SEPARATOR}\n`)).toEqual({ verdicts: [], garbage: [] });
  });
});

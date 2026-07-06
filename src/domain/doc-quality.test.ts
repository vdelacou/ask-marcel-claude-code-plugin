import { describe, expect, test } from 'bun:test';

import { assessMarkdownQuality } from './doc-quality.ts';

describe('assessMarkdownQuality', () => {
  test('well-formed prose is good', () => {
    expect(assessMarkdownQuality('# Q3 Report\n\nThe quarterly envelope was approved by the committee on Tuesday.')).toBe('good');
  });

  test('content in any script counts as visible content (CJK, Arabic)', () => {
    expect(assessMarkdownQuality('# 季度报告\n\n本季度的预算已获管理委员会批准，详见随附的说明文件。')).toBe('good');
    expect(assessMarkdownQuality('التقرير الفصلي تمت الموافقة على الميزانية من قبل اللجنة يوم الثلاثاء الماضي')).toBe('good');
  });

  test('a conversion shorter than the minimum content length is scrambled, edges trimmed first', () => {
    expect(assessMarkdownQuality('   \n\n  ')).toBe('scrambled');
    // 24 chars raw but only 18 after trimming the surrounding whitespace, so it is still near-empty
    expect(assessMarkdownQuality('   under twenty-four!   ')).toBe('scrambled');
  });

  test('a conversion at exactly the minimum content length with real prose is good', () => {
    // exactly 24 chars of prose clears the near-empty gate
    expect(assessMarkdownQuality('Budget approved by board')).toBe('good');
  });

  test('replacement-character soup (a scanned-image OCR failure) is scrambled', () => {
    expect(assessMarkdownQuality('The ��� document ��� is ��� mostly ��� unreadable ��� gibberish ���')).toBe('scrambled');
  });

  test('a single stray replacement char in an otherwise clean long document stays good', () => {
    expect(assessMarkdownQuality('The quarterly plan was approved � and the rollout begins next week across every region.')).toBe('good');
  });

  test('table-soup — visible characters are mostly drawing rules — is scrambled', () => {
    expect(assessMarkdownQuality('| --- | --- | --- |\n| --- | --- | --- |\n| --- | --- | --- |')).toBe('scrambled');
  });

  test('whitespace between rules does not rescue table-soup (spaces are not visible content)', () => {
    expect(assessMarkdownQuality('|            |            |            |            |            |')).toBe('scrambled');
  });

  test('a page of only pipes or only dashes (both are drawing rules) is scrambled', () => {
    expect(assessMarkdownQuality('||||||||||||||||||||||||||||||')).toBe('scrambled');
    expect(assessMarkdownQuality('------------------------------')).toBe('scrambled');
  });

  test('a real markdown table with cell content stays good', () => {
    expect(assessMarkdownQuality('| Region | Revenue |\n| --- | --- |\n| Greater China | 1200000 |\n| Japan | 800000 |')).toBe('good');
  });
});

import { describe, expect, test } from 'bun:test';

import { asStringArray, extractJsonObject } from './llm-json.ts';

describe('llm-json', () => {
  test('a raw object, a fenced object, and prose-wrapped JSON all recover the same record', () => {
    const expected = { id: 'm1', ok: true };
    expect(extractJsonObject('{"id":"m1","ok":true}')).toEqual(expected);
    expect(extractJsonObject('```json\n{"id":"m1","ok":true}\n```')).toEqual(expected);
    expect(extractJsonObject('Here is my verdict:\n{"id":"m1","ok":true}\nDone.')).toEqual(expected);
  });

  test('broken JSON, non-objects, and brace-less text stay undefined', () => {
    expect(extractJsonObject('{"id": unterminated')).toBeUndefined();
    expect(extractJsonObject('{"id": nope}')).toBeUndefined(); // braces present, interior invalid - the catch path
    expect(extractJsonObject('[1, 2, 3]')).toBeUndefined();
    expect(extractJsonObject('no braces at all')).toBeUndefined();
    expect(extractJsonObject('}{')).toBeUndefined();
  });

  test('asStringArray keeps the strings and drops everything else', () => {
    expect(asStringArray(['a', 42, 'b', null])).toEqual(['a', 'b']);
    expect(asStringArray('not an array')).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
  });
});

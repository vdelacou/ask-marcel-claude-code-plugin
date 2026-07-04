import { describe, expect, test } from 'bun:test';

import { bucketFor, isSubstantive } from './voice-rules.ts';
import type { OrgContext } from './voice-rules.ts';

const ORG: OrgContext = { ownDomains: ['internal-corp.com', 'internal-corp.onmicrosoft.com'], managerEmails: ['jane.boss@internal-corp.com'] };

describe('voice rules', () => {
  test('one-line acks are not substantive; real messages are', () => {
    expect(isSubstantive('Thanks, noted.')).toBe(false);
    expect(isSubstantive('Ok for me')).toBe(false);
    expect(isSubstantive('Hello Jane, confirmed for Ledger - we align with the group choice and I will push the QUICK OB step next week.')).toBe(true);
    expect(isSubstantive('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen')).toBe(true);
    expect(isSubstantive('  one two three four  five six seven eight nine ten eleven twelve thirteen fourteen')).toBe(false);
  });

  test('Chinese text is substantive by character count, short acks are not', () => {
    expect(isSubstantive('我们已经确认了下周的会议安排，请準备好预算材料和最新的项目进度报告。')).toBe(true);
    expect(isSubstantive('收到，谢谢。')).toBe(false);
    expect(isSubstantive('好的 ok noted 明白')).toBe(false);
    expect(isSubstantive('회의 일정을 확인했습니다. 다음 주 화요일 오전에 예산 자료를 준비해서 보고하겠습니다.')).toBe(true);
  });

  test('recipients bucket into upward, peers, external, and broadcast', () => {
    expect(bucketFor(['Jane.Boss@internal-corp.com'], [], ORG)).toBe('upward');
    const twoManagers: OrgContext = { ...ORG, managerEmails: ['jane.boss@internal-corp.com', 'other.boss@internal-corp.com'] };
    expect(bucketFor(['a@internal-corp.com'], ['jane.boss@internal-corp.com'], twoManagers)).toBe('upward');
    expect(bucketFor(['a@internal-corp.com'], ['b@internal-corp.com', 'c@internal-corp.com', 'd@internal-corp.com', 'e@internal-corp.com'], ORG)).toBe('peers');
    expect(bucketFor(['a@internal-corp.com', 'vendor@ext-corp.com'], [], ORG)).toBe('external');
    expect(bucketFor(['a@internal-corp.com'], ['b@internal-corp.com', 'c@internal-corp.com', 'd@internal-corp.com', 'e@internal-corp.com', 'f@internal-corp.com'], ORG)).toBe(
      'broadcast'
    );
    expect(bucketFor(['vendor@ext-corp.com'], ['a@internal-corp.com'], ORG)).toBe('external');
    expect(bucketFor(['a@internal-corp.com', 'b@internal-corp.com'], [], ORG)).toBe('peers');
    expect(bucketFor(['vendor@ext-corp.com'], ['jane.boss@internal-corp.com'], ORG)).toBe('upward');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEMORY_FIELDS,
  MEMORY_VALUE_MAX,
  memoryValueTooLong,
} from '../lib/practice/memory.ts';
import { translate } from '../lib/i18n.ts';

test('practice.memory: 기억 화면의 항목은 넷이고 성별·나이는 없다', () => {
  assert.deepEqual([...MEMORY_FIELDS], ['goal', 'blockage', 'speech_self', 'speech_actual']);
  assert.equal(MEMORY_FIELDS.includes('gender'), false);
  assert.equal(MEMORY_FIELDS.includes('age'), false);
  // 성별·나이 자리에는 프로필 안내가 대신 선다.
  assert.match(translate('memory.profileNotice'), /프로필|profile/i);
});

test('practice.memory: 1,000자는 저장하고 1,001자는 화면이 먼저 막는다', () => {
  assert.equal(MEMORY_VALUE_MAX, 1_000);
  assert.equal(memoryValueTooLong('가'.repeat(1_000)), false);
  assert.equal(memoryValueTooLong('가'.repeat(1_001)), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PURPOSE,
  SESSION_PURPOSES,
  blockageCategoryFor,
  firstUploadStep,
  previousUploadStep,
  purposeFor,
  stepperIndex,
} from '../lib/practice/session-purpose.ts';
import { splitTimestamps, timestampSeconds } from '../lib/practice/coach-timestamps.ts';

test('세션 목적 세 갈래는 기존 막힘 큰 갈래로 간다 — 평가=그 외, 막힌 곳=표현, 인물=분석(SOMA-748)', () => {
  assert.deepEqual([...SESSION_PURPOSES], ['review', 'unblock', 'character']);
  assert.equal(DEFAULT_PURPOSE, 'review');
  assert.equal(blockageCategoryFor('review'), '그 외');
  assert.equal(blockageCategoryFor('unblock'), '표현');
  assert.equal(blockageCategoryFor('character'), '분석');
  // 되돌리기 — 모르는 값·없음은 기본(평가 받기)
  assert.equal(purposeFor('표현'), 'unblock');
  assert.equal(purposeFor('분석'), 'character');
  assert.equal(purposeFor('그 외'), 'review');
  assert.equal(purposeFor(null), 'review');
});

test('새 연습 단계: 목적 → 영상(장면 단계 없음, SOMA-778), 예시·튜토리얼은 바로 영상 단계', () => {
  assert.equal(firstUploadStep({ sample: false, tutorial: false }), 'purpose');
  assert.equal(firstUploadStep({ sample: true, tutorial: false }), 'source');
  assert.equal(firstUploadStep({ sample: false, tutorial: true }), 'source');
  assert.equal(previousUploadStep('source'), 'purpose');
  assert.equal(previousUploadStep('purpose'), null);
  assert.equal(stepperIndex('purpose'), 1);
  assert.equal(stepperIndex('source'), 2);
});

test('액티 말 속 「0:12」는 누를 수 있는 시간 조각으로 나뉜다(pen 시간 눌러 장면 보기)', () => {
  assert.deepEqual(splitTimestamps('0:12 「우리 그만하자」 뒤에 2초 멈췄어요.'), [
    { kind: 'time', text: '0:12', seconds: 12 },
    { kind: 'text', text: ' 「우리 그만하자」 뒤에 2초 멈췄어요.' },
  ]);
  assert.deepEqual(splitTimestamps('앞 1:05와 12:30 사이'), [
    { kind: 'text', text: '앞 ' },
    { kind: 'time', text: '1:05', seconds: 65 },
    { kind: 'text', text: '와 ' },
    { kind: 'time', text: '12:30', seconds: 750 },
    { kind: 'text', text: ' 사이' },
  ]);
  // 시간이 아닌 것 — 초가 60 이상, 비율·시각 꼴(10:300), 앞뒤로 숫자가 붙은 것
  assert.deepEqual(splitTimestamps('3:75 비율, 10:300'), [{ kind: 'text', text: '3:75 비율, 10:300' }]);
  assert.deepEqual(splitTimestamps(''), []);
  assert.equal(timestampSeconds('2:03'), 123);
  assert.equal(timestampSeconds('x'), null);
});

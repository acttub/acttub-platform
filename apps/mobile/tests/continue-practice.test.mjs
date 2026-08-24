import assert from 'node:assert/strict';
import test from 'node:test';

import { setPrefill, takePrefill } from '../lib/practice.ts';

const SCENE = { situation: '이별 직후 카페', character: '참는 사람', goal: '붙잡기' };

test('이어서 연습: 직후 노트는 장면 프리필과 이어받기를 함께 싣는다', () => {
  setPrefill({ scene: SCENE, continuedFrom: 'session-1' });

  const p = takePrefill();
  assert.deepEqual(p, { scene: SCENE, continuedFrom: 'session-1' });
});

test('이어서 연습: 지난 기록은 장면 없이 이어받기만 건다', () => {
  // 리포트 상세 응답에 장면 원문이 없어 폼은 비운 채 시작한다.
  setPrefill({ scene: null, continuedFrom: 'session-2' });

  const p = takePrefill();
  assert.equal(p.scene, null);
  assert.equal(p.continuedFrom, 'session-2');
});

test('프리필은 한 번 꺼내면 사라진다 — 다음 새 연습에 이어받기가 새면 안 된다', () => {
  setPrefill({ scene: SCENE, continuedFrom: 'session-3' });

  takePrefill();
  assert.equal(takePrefill(), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { setContinueOrigin, takeContinueOrigin } from '../lib/practice/session-state.ts';

const SCENE = { situation: '이별 직후 카페', character: '참는 사람', goal: '붙잡기' };

test('practice.resume: 방금 끝낸 노트는 묶음·회차와 장면을 함께 싣는다', () => {
  setContinueOrigin({ kind: 'note', rootId: 'root-1', practiceId: 'practice-1', scene: SCENE });

  assert.deepEqual(takeContinueOrigin(), {
    kind: 'note',
    rootId: 'root-1',
    practiceId: 'practice-1',
    scene: SCENE,
  });
});

test('practice.resume: 지난 기록은 그 회차의 영상만 싣고 장면은 싣지 않는다', () => {
  setContinueOrigin({ kind: 'history', rootId: 'root-1', practiceId: 'practice-2', videoId: 'video-2' });

  const origin = takeContinueOrigin();
  assert.equal(origin.kind, 'history');
  assert.equal(origin.videoId, 'video-2');
  assert.equal('scene' in origin, false);
});

test('practice.resume: 한 번 꺼내면 사라진다 — 다음 새 연습에 이어받기가 새면 안 된다', () => {
  setContinueOrigin({ kind: 'group', rootId: 'root-3', practiceId: 'practice-3' });

  takeContinueOrigin();
  assert.equal(takeContinueOrigin(), null);
});

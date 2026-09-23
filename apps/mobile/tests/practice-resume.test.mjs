import assert from 'node:assert/strict';
import test from 'node:test';

import { canStart, continueVideoId, planFor } from '../lib/practice/resume.ts';

const SCENE = { situation: '이별 직후 카페', character: '참는 사람', goal: '붙잡기' };

test('practice.resume: 방금 끝낸 노트에서 이어가면 준비 화면에 이전 장면이 채워져 있다', () => {
  const plan = planFor({ kind: 'note', rootId: 'root-1', practiceId: 'practice-1', scene: SCENE });

  assert.deepEqual(plan.scene, SCENE);
  assert.equal(plan.prefilled, true);
  assert.deepEqual(plan.continueFrom, { rootId: 'root-1', practiceId: 'practice-1' });
  // A13에서 이어가는 연습은 영상을 새로 고른다.
  assert.deepEqual(plan.video, { kind: 'pick' });
});

test('practice.resume: 지난 기록에서 이어가면 장면은 비어 있고 영상은 그 회차의 것이다', () => {
  const plan = planFor({ kind: 'history', rootId: 'root-1', practiceId: 'practice-1', videoId: 'video-1' });

  assert.deepEqual(plan.scene, { situation: '', character: '', goal: '' });
  assert.equal(plan.prefilled, false);
  assert.deepEqual(plan.video, { kind: 'same', videoId: 'video-1' });
  // 같은 영상이면 본문에 video_id를 싣지 않는다 — 서버가 1차의 영상을 그대로 쓴다.
  assert.equal(continueVideoId(plan, null), null);
  assert.equal(canStart(plan, null), true);
});

test('practice.resume: 새 연습 화면에서 이전 연습을 이어가면 빈 화면이고 새 영상을 싣는다', () => {
  const plan = planFor({ kind: 'group', rootId: 'root-2', practiceId: 'practice-2' });

  assert.equal(plan.prefilled, false);
  assert.deepEqual(plan.scene, { situation: '', character: '', goal: '' });
  assert.equal(canStart(plan, null), false);
  assert.equal(canStart(plan, 'video-new'), true);
  assert.equal(continueVideoId(plan, 'video-new'), 'video-new');
});

test('practice.start: 이어하기가 아니면 빈 준비 화면이고 영상을 골라야 시작한다', () => {
  const plan = planFor(null);

  assert.equal(plan.continueFrom, null);
  assert.equal(plan.prefilled, false);
  assert.equal(canStart(plan, null), false);
  assert.equal(canStart(plan, 'video-1'), true);
});

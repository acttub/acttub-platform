import assert from 'node:assert/strict';
import test from 'node:test';

import { translate } from '../lib/i18n.ts';
import { canStart, continueActionFor, continueActionLabel, planFor } from '../lib/practice/resume.ts';

const SCENE = { situation: '이별 직후 카페', character: '참는 사람', goal: '붙잡기' };

test('practice.resume: 방금 끝낸 노트에서 다음 테이크를 찍으면 이전 장면이 채워져 있다', () => {
  const plan = planFor({ kind: 'note', rootId: 'root-1', practiceId: 'practice-1', scene: SCENE });

  assert.deepEqual(plan.scene, SCENE);
  assert.equal(plan.prefilled, true);
  assert.deepEqual(plan.continueFrom, { rootId: 'root-1', practiceId: 'practice-1' });
});

test('practice.resume: 지난 기록·액티에서 다음 테이크를 찍으면 장면은 비어 있다', () => {
  const plan = planFor({ kind: 'group', rootId: 'root-2', practiceId: 'practice-2' });

  assert.equal(plan.prefilled, false);
  assert.deepEqual(plan.scene, { situation: '', character: '', goal: '' });
  assert.deepEqual(plan.continueFrom, { rootId: 'root-2', practiceId: 'practice-2' });
});

test('practice.resume: 다음 테이크는 지난 영상을 몰래 다시 쓰지 않는다 — 새로 고른 영상이 있어야 시작한다(SOMA-672)', () => {
  for (const origin of [
    { kind: 'note', rootId: 'r', practiceId: 'p', scene: SCENE },
    { kind: 'group', rootId: 'r', practiceId: 'p' },
    // 옛 출처('history' + videoId)가 남아 들어와도 같은 영상으로 시작하지 않는다.
    { kind: 'history', rootId: 'r', practiceId: 'p', videoId: 'video-old' },
  ]) {
    const plan = planFor(origin);
    assert.equal('video' in plan, false);
    assert.equal(canStart(null), false);
  }
  assert.equal(canStart('video-new'), true);
});

test('practice.start: 이어하기가 아니면 빈 준비 화면이고 영상을 골라야 시작한다', () => {
  const plan = planFor(null);

  assert.equal(plan.continueFrom, null);
  assert.equal(plan.prefilled, false);
  assert.equal(canStart(null), false);
  assert.equal(canStart('video-1'), true);
});

test('practice.resume: 열린 테이크가 있으면 「대화 이어 가기」, 없으면 「다음 테이크 찍기」 하나만 고른다(SOMA-672)', () => {
  assert.deepEqual(continueActionFor({ in_progress_practice_id: 'practice-9' }), { kind: 'resume', practiceId: 'practice-9' });
  assert.deepEqual(continueActionFor({ in_progress_practice_id: null }), { kind: 'nextTake' });
  assert.deepEqual(continueActionFor(null), { kind: 'nextTake' });

  assert.equal(translate(continueActionLabel({ kind: 'resume', practiceId: 'p' })), '대화 이어 가기');
  assert.equal(translate(continueActionLabel({ kind: 'nextTake' })), '다음 테이크 찍기');
});

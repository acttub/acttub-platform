import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  clearPractice,
  getPractice,
  resetPracticeState,
  setContinueOrigin,
  startPractice,
  takeContinueOrigin,
} from '../lib/practice/session-state.ts';

const scene = { situation: '갈매기 마지막 장', character: '니나', goal: '떠나기 전에 마음을 전한다' };

beforeEach(() => resetPracticeState());

test('practice.start: 새 회차를 시작하면 대화도 노트도 없이 화면 사이로 들고 다닌다', () => {
  const started = startPractice({
    practiceId: 'p-2',
    rootId: 'p-1',
    ordinal: 2,
    scene,
    videoUri: 'file:///docs/archive/rec-1.mp4',
    playbackUrl: null,
  });
  const expected = {
    practiceId: 'p-2',
    rootId: 'p-1',
    ordinal: 2,
    conversationId: null,
    scene,
    videoUri: 'file:///docs/archive/rec-1.mp4',
    playbackUrl: null,
    note: null,
  };
  assert.deepEqual(started, expected);
  assert.deepEqual(getPractice(), expected);
});

test('practice.resume: 이미 시작한 대화가 있는 회차는 그 대화 id 를 들고 시작한다', () => {
  startPractice({
    practiceId: 'p-3',
    rootId: 'p-3',
    ordinal: 1,
    scene,
    videoUri: '',
    playbackUrl: 'https://cdn/p-3.mp4',
    conversationId: 'c-9',
  });
  assert.equal(getPractice()?.conversationId, 'c-9');
  assert.equal(getPractice()?.playbackUrl, 'https://cdn/p-3.mp4');
});

test('회차를 비우면 이어하기 출처는 남고, 전체 초기화는 둘 다 버린다(탈퇴·계정 교체)', () => {
  startPractice({ practiceId: 'p-4', rootId: 'p-4', ordinal: 1, scene, videoUri: '', playbackUrl: null });
  setContinueOrigin({ kind: 'group', rootId: 'p-4', practiceId: 'p-4' });
  clearPractice();
  assert.equal(getPractice(), null);
  assert.deepEqual(takeContinueOrigin(), { kind: 'group', rootId: 'p-4', practiceId: 'p-4' });

  startPractice({ practiceId: 'p-5', rootId: 'p-5', ordinal: 1, scene, videoUri: '', playbackUrl: null });
  setContinueOrigin({ kind: 'group', rootId: 'p-5', practiceId: 'p-5' });
  resetPracticeState();
  assert.equal(getPractice(), null);
  assert.equal(takeContinueOrigin(), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { initialPickedVideo, peekPickedVideo, setPickedVideo } from '../lib/practice/picked-video.ts';
import { setContinueOrigin, takeContinueOrigin } from '../lib/practice/session-state.ts';

const SCENE = { situation: '이별 직후 카페', character: '참는 사람', goal: '붙잡기' };
const VIDEO = { videoId: 'video-old', pendingId: null, uri: null, playbackUrl: null, durationMs: 1000 };

test('practice.resume: 방금 끝낸 노트는 묶음·회차와 장면을 함께 싣는다', () => {
  setContinueOrigin({ kind: 'note', rootId: 'root-1', practiceId: 'practice-1', scene: SCENE });

  assert.deepEqual(takeContinueOrigin(), {
    kind: 'note',
    rootId: 'root-1',
    practiceId: 'practice-1',
    scene: SCENE,
  });
});

test('practice.resume: 지난 기록은 묶음·회차만 싣는다 — 영상도 장면도 싣지 않는다(SOMA-672)', () => {
  setContinueOrigin({ kind: 'group', rootId: 'root-1', practiceId: 'practice-2' });

  const origin = takeContinueOrigin();
  assert.equal(origin.kind, 'group');
  assert.equal('videoId' in origin, false);
  assert.equal('scene' in origin, false);
});

test('practice.resume: 한 번 꺼내면 사라진다 — 다음 새 연습에 이어받기가 새면 안 된다', () => {
  setContinueOrigin({ kind: 'group', rootId: 'root-3', practiceId: 'practice-3' });

  takeContinueOrigin();
  assert.equal(takeContinueOrigin(), null);
});

test('practice.resume: 다음 테이크는 빈 영상 상자에서 시작한다 — 전에 얹힌 영상이 새지 않는다(SOMA-672)', () => {
  setPickedVideo(VIDEO);
  assert.equal(initialPickedVideo(true), null);
  // 버린 영상은 화면에 돌아왔을 때도 다시 들어오지 않는다.
  assert.equal(peekPickedVideo(), null);
});

test('practice.start: 새 연습은 보관함 상세에서 넘긴 영상을 그대로 받는다', () => {
  setPickedVideo(VIDEO);
  assert.deepEqual(initialPickedVideo(false), VIDEO);
});

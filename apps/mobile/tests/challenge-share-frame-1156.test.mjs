import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canPickFrame,
  DEFAULT_SHARE_FRAME,
  FRAME_POLL_MS,
  FRAME_WAIT_MS,
  frameLabel,
  isMosaicNotReady,
  prepareShareFile,
  SHARE_FRAMES,
  shareFailureMessage,
  ShareError,
  STORY_VIDEO_MAX_BYTES,
} from '../lib/challenge/share.ts';

const mine = { id: 'e1', is_mine: true, published_at: null, playback_url: 'https://v/1.mp4' };

/** 서버 응답을 차례로 돌려주는 가짜 연결. 시계는 wait 만큼 간다. */
function fakeDeps(responses, { size = 10 } = {}) {
  const calls = { requested: [], downloaded: [], removed: [], waited: [] };
  let clock = 0;
  const deps = {
    requestFrame: async (entryId, frame) => {
      calls.requested.push(`${entryId}:${frame}`);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    wait: async (ms) => {
      calls.waited.push(ms);
      clock += ms;
    },
    now: () => clock,
    download: async (url) => {
      calls.downloaded.push(url);
      return { uri: `file://${url.split('/').pop()}`, size };
    },
    remove: (uri) => calls.removed.push(uri),
  };
  return { deps, calls };
}

test('프레임: 흰색·파랑·검정·없음 순서이고 기본은 흰색이다', () => {
  assert.deepEqual([...SHARE_FRAMES], ['white', 'blue', 'black', 'none']);
  assert.equal(DEFAULT_SHARE_FRAME, 'white');
  assert.deepEqual(SHARE_FRAMES.map(frameLabel), ['흰색', '파랑', '검정', '없음']);
});

test('프레임: 고르기는 영상이 나가는 길(내 참여작·재생 주소)이 있을 때만 보인다', () => {
  assert.equal(canPickFrame(mine), true);
  assert.equal(canPickFrame({ ...mine, is_mine: false }), false);
  assert.equal(canPickFrame({ ...mine, playback_url: null }), false);
});

test('프레임: 없음이면 서버에 묻지 않고 재생 주소의 영상을 그대로 받는다', async () => {
  const { deps, calls } = fakeDeps([]);
  assert.equal(await prepareShareFile(mine, 'none', deps), 'file://1.mp4');
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.downloaded, ['https://v/1.mp4']);
});

test('프레임: 만드는 동안 간격을 두고 다시 묻고, 준비되면 프레임 영상을 받는다', async () => {
  const { deps, calls } = fakeDeps([
    { status: 'rendering', video_url: null },
    { status: 'rendering', video_url: null },
    { status: 'ready', video_url: 'https://f/framed.mp4' },
  ]);
  assert.equal(await prepareShareFile(mine, 'blue', deps), 'file://framed.mp4');
  assert.deepEqual(calls.requested, ['e1:blue', 'e1:blue', 'e1:blue']);
  assert.deepEqual(calls.waited, [FRAME_POLL_MS, FRAME_POLL_MS]);
  assert.deepEqual(calls.downloaded, ['https://f/framed.mp4']);
});

test('프레임: 서버가 failed 를 주면 frame_failed 이고 원본으로 대신 받지 않는다', async () => {
  const { deps, calls } = fakeDeps([{ status: 'rendering', video_url: null }, { status: 'failed', video_url: null }]);
  await assert.rejects(prepareShareFile(mine, 'white', deps), (e) => e instanceof ShareError && e.kind === 'frame_failed');
  assert.deepEqual(calls.downloaded, []);
  assert.equal(shareFailureMessage('frame_failed'), '프레임을 넣지 못했어요. 다시 해 주세요.');
});

test('프레임: 요청이 실패해도 frame_failed 다', async () => {
  const { deps, calls } = fakeDeps([new Error('404')]);
  await assert.rejects(prepareShareFile(mine, 'black', deps), (e) => e instanceof ShareError && e.kind === 'frame_failed');
  assert.deepEqual(calls.downloaded, []);
});

test('프레임: 얼굴 가림이 준비되지 않았으면(422 mosaic_not_ready) mosaic_not_ready 이고 원본을 받지 않는다', async () => {
  const notReady = Object.assign(new Error('mosaic'), { status: 422, code: 'mosaic_not_ready' });
  const { deps, calls } = fakeDeps([notReady]);
  await assert.rejects(prepareShareFile(mine, 'white', deps), (e) => e instanceof ShareError && e.kind === 'mosaic_not_ready');
  assert.deepEqual(calls.downloaded, []);
  assert.equal(isMosaicNotReady(notReady), true);
  assert.equal(isMosaicNotReady(new Error('404')), false);
  assert.equal(shareFailureMessage('mosaic_not_ready'), '얼굴 가림을 준비하고 있어요. 잠시 후 다시 해 주세요.');
});

test('프레임: 기다리는 한도를 넘기면 frame_failed 다', async () => {
  const forever = Array.from({ length: FRAME_WAIT_MS / FRAME_POLL_MS + 5 }, () => ({ status: 'rendering', video_url: null }));
  const { deps, calls } = fakeDeps(forever);
  await assert.rejects(prepareShareFile(mine, 'white', deps), (e) => e instanceof ShareError && e.kind === 'frame_failed');
  assert.equal(calls.waited.length, FRAME_WAIT_MS / FRAME_POLL_MS);
  assert.deepEqual(calls.downloaded, []);
});

test('프레임: 재생 주소가 없으면 묻지 않고 no_video, 받은 프레임 영상이 너무 크면 지우고 too_large', async () => {
  const empty = fakeDeps([]);
  await assert.rejects(
    prepareShareFile({ ...mine, playback_url: null }, 'white', empty.deps),
    (e) => e instanceof ShareError && e.kind === 'no_video',
  );
  assert.deepEqual(empty.calls.requested, []);

  const big = fakeDeps([{ status: 'ready', video_url: 'https://f/big.mp4' }], { size: STORY_VIDEO_MAX_BYTES + 1 });
  await assert.rejects(prepareShareFile(mine, 'white', big.deps), (e) => e instanceof ShareError && e.kind === 'too_large');
  assert.deepEqual(big.calls.removed, ['file://big.mp4']);
});

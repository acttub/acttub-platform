import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canSaveVideo,
  hasShareOptions,
  prepareVideoFile,
  shareFailureKind,
  shareFailureMessage,
  shareMessage,
  shareTargets,
  ShareError,
  storyRoute,
  STORY_VIDEO_MAX_BYTES,
  threadsIntentUrl,
} from '../lib/challenge/share.ts';

const mine = { is_mine: true, published_at: '2026-10-20T00:00:00Z', playback_url: 'https://v/1.mp4' };
const mineQuiet = { ...mine, published_at: null };
const others = { ...mine, is_mine: false };

test('공유 대상: 내 공개 참여작은 인스타 스토리와 링크 대상 모두, 순서는 시트 그대로', () => {
  assert.deepEqual(shareTargets(mine), ['instagram', 'kakao', 'threads', 'copy', 'more']);
  assert.equal(canSaveVideo(mine), true);
});

test('공유 대상: 남의 영상은 링크만 나가고 영상은 저장·스토리로 못 보낸다', () => {
  assert.deepEqual(shareTargets(others), ['kakao', 'threads', 'copy', 'more']);
  assert.equal(canSaveVideo(others), false);
});

test('공유 대상: 비공개 내 참여작은 영상 길(스토리·저장)만, 링크는 보내지 않는다', () => {
  assert.deepEqual(shareTargets(mineQuiet), ['instagram']);
  assert.equal(canSaveVideo(mineQuiet), true);
  assert.equal(hasShareOptions(mineQuiet), true);
});

test('공유 대상: 재생 주소가 없으면 영상 길이 닫히고 길이 하나도 없으면 시트를 열지 않는다', () => {
  const none = { is_mine: true, published_at: null, playback_url: null };
  assert.deepEqual(shareTargets(none), []);
  assert.equal(canSaveVideo(none), false);
  assert.equal(hasShareOptions(none), false);
  assert.equal(hasShareOptions({ ...others, published_at: null }), false);
});

test('링크 문장과 스레드 intent 는 같은 문장을 쓰고 주소를 인코딩한다', () => {
  const message = shareMessage({ id: 'e 1' }, '지성', '잘 지내');
  assert.match(message, /^지성의 “잘 지내” 연기 — acttub 챌린지\nhttps:\/\/acttub\.com\/e\/e%201$/);
  const url = threadsIntentUrl({ id: 'e1' }, '지성', '잘 지내');
  assert.ok(url.startsWith('https://www.threads.net/intent/post?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), shareMessage({ id: 'e1' }, '지성', '잘 지내'));
});

test('인스타 길: 설치돼 있으면 스토리, 없으면 스토어, 스토어도 없으면 일반 공유', () => {
  assert.equal(storyRoute({ installed: true, storeUrl: 'x' }), 'story');
  assert.equal(storyRoute({ installed: false, storeUrl: 'x' }), 'store');
  assert.equal(storyRoute({ installed: false, storeUrl: null }), 'generic');
});

test('영상 준비: 주소가 없으면 no_video 이고 받지 않는다', async () => {
  let called = false;
  await assert.rejects(
    prepareVideoFile({ playback_url: null }, { download: async () => ((called = true), { uri: 'f', size: 1 }) }),
    (e) => e instanceof ShareError && e.kind === 'no_video',
  );
  assert.equal(called, false);
});

test('영상 준비: 받기에 성공하면 로컬 파일 주소를 돌려준다(크기를 모르면 통과)', async () => {
  const seen = [];
  const uri = await prepareVideoFile(
    { playback_url: 'https://v/1.mp4' },
    { download: async (u) => (seen.push(u), { uri: 'file:///c/a.mp4', size: null }) },
  );
  assert.equal(uri, 'file:///c/a.mp4');
  assert.deepEqual(seen, ['https://v/1.mp4']);
});

test('영상 준비: 받기가 실패하면 download_failed', async () => {
  await assert.rejects(
    prepareVideoFile({ playback_url: 'u' }, { download: async () => Promise.reject(new Error('net')) }),
    (e) => e instanceof ShareError && e.kind === 'download_failed',
  );
});

test('영상 준비: 상한을 넘으면 too_large 이고 받은 파일을 지운다', async () => {
  const removed = [];
  await assert.rejects(
    prepareVideoFile(
      { playback_url: 'u' },
      { download: async () => ({ uri: 'file:///big.mp4', size: STORY_VIDEO_MAX_BYTES + 1 }), remove: (u) => removed.push(u) },
    ),
    (e) => e.kind === 'too_large',
  );
  assert.deepEqual(removed, ['file:///big.mp4']);
  // 정확히 상한이면 통과한다.
  assert.equal(
    await prepareVideoFile({ playback_url: 'u' }, { download: async () => ({ uri: 'ok', size: STORY_VIDEO_MAX_BYTES }) }),
    'ok',
  );
});

test('실패 안내: 종류마다 문구가 있고 모르는 오류는 받기 실패로 본다', () => {
  assert.equal(shareFailureKind(new ShareError('save_failed')), 'save_failed');
  assert.equal(shareFailureKind(new Error('x')), 'download_failed');
  for (const kind of ['no_video', 'too_large', 'download_failed', 'permission_denied', 'save_failed']) {
    const text = shareFailureMessage(kind);
    assert.ok(text && !text.startsWith('entryShare.'), kind);
  }
});

test('설정: 스토리 App ID 는 fbsdk appID 와 같고 쿼리 스킴·사진첩 권한이 있다', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const fb = app.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-fbsdk-next')[1];
  const native = readFileSync(new URL('../lib/challenge/share-native.ts', import.meta.url), 'utf8');
  assert.match(native, new RegExp(`FACEBOOK_APP_ID = '${fb.appID}'`));
  const share = app.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-share')[1];
  assert.ok(share.ios.includes('instagram-stories'));
  assert.deepEqual(share.android, ['com.instagram.android']);
  const media = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-media-library')[1];
  assert.ok(media.savePhotosPermission && media.photosPermission);
  assert.ok(app.ios.infoPlist.NSPhotoLibraryAddUsageDescription);
});

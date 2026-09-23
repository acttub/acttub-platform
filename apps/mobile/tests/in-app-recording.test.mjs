import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 앱 내 영상 촬영 (SOMA-477). 촬영 화면은 네이티브(expo-camera)라 node로 못 돌린다.
 * 대신 배선 — 업로드가 촬영으로 보내고, 결과를 받아 검증에 태우는지 — 를 잠근다.
 */

test('SOMA-477: 새 연습 준비 화면에서 촬영·보관함·갤러리로 갈 수 있다', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /pathname: '\/record-video'/);
  assert.match(upload, /upload\.recordCta/); // 촬영하기 버튼
  assert.match(upload, /upload\.pickGallery/); // 갤러리에서 고르기 버튼
  assert.match(upload, /start\.fromLibrary/); // 보관함에서 고르기 버튼
});

test('practice.start: 고른 영상은 보관함을 거쳐 오고 준비 화면은 올리지 않는다', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /takePickedVideo/);
  // 갤러리에서 고른 것도 보관함 큐에 먼저 들어간다(practice.record).
  assert.match(upload, /saveRecordingToLibrary/);
  // 준비 화면에는 옛 업로드 경로가 없다.
  assert.equal(/createUploadIntent|completeUpload/.test(upload), false);
});

test('SOMA-477: 촬영 화면이 5분 상한과 핸드오프를 지킨다', () => {
  const screen = read('app/record-video.tsx');
  assert.match(screen, /MAX_VIDEO_DURATION_MS/); // 서버·업로드 상한과 같은 값
  assert.match(screen, /maxDuration/);
  assert.match(screen, /setRecordedVideo/);
  // 촬영본은 보관함에 저장한 뒤 그 항목을 새 연습으로 넘긴다.
  assert.match(screen, /saveRecordingToLibrary/);
  assert.match(screen, /setPickedVideo/);
});

test('SOMA-477: 카메라 권한·플러그인이 설정에 있다', () => {
  const appJson = read('app.json');
  assert.match(appJson, /expo-camera/);
  assert.match(appJson, /NSCameraUsageDescription/);
  assert.match(appJson, /android\.permission\.CAMERA/);
});

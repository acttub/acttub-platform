import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * 줄 녹음이 빈 파일로 올라가던 문제(0.1.2 운영 녹음의 84%가 258바이트) 잠그기.
 * 인식기 녹음은 Android 13+·iOS 만 되고, 끝난 파일은 audioend 뒤에야 다 써진다.
 */
test('reading.recording: 인식기 녹음은 기기가 지원할 때만 켠다', () => {
  const stt = read('hooks/use-reading-stt.ts');
  assert.match(stt, /supportsRecording\(\)/);
  assert.match(stt, /canPersist/);
});

test('reading.recording: 인식기 파일은 audioend 를 기다려 가져간다', () => {
  const stt = read('hooks/use-reading-stt.ts');
  assert.match(stt, /takeRecordingAsync/);
  const play = read('app/reading/play.tsx');
  assert.match(play, /await stt\.takeRecordingAsync\(\)/);
  assert.doesNotMatch(play, /uri = stt\.takeRecordingUri\(\)/);
});

test('reading.recording: 녹음이 켜졌는데 인식기가 녹음을 못 하면 녹음기로 받는다', () => {
  const play = read('app/reading/play.tsx');
  assert.match(play, /session\.record && !stt\.canPersist\(\)/);
});

test('reading.recording: 비어서 버린 녹음은 계측한다', () => {
  assert.match(read('app/reading/play.tsx'), /logEvent\('reading_recording_empty'/);
});

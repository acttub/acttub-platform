import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// 긴 세션에서 앱 메모리(256MB)가 차 꺼졌다(SOMA-699). 영상 플레이어 하나가 20MB 넘게 잡았고, 영상 화면이 겹쳐 쌓였다.
const PLAYERS = [
  'app/challenge-upload.tsx',
  'app/upload.tsx',
  'app/challenge-play.tsx',
  'components/practice-chrome.tsx',
];

test('안드로이드 영상 플레이어는 모두 미리 받아 두는 양에 상한을 건다(SOMA-699)', () => {
  const lib = read('lib/video-memory.ts');
  assert.match(lib, /maxBufferBytes: 10 \* 1024 \* 1024/);
  assert.match(lib, /preferredForwardBufferDuration: 10/);
  assert.match(lib, /if \(Platform\.OS !== 'android'\) return;/);
  for (const file of PLAYERS) {
    assert.match(read(file), /useVideoPlayer\([\s\S]*?\(p\) => \{[\s\S]*?limitVideoBuffer\(p\);/, file);
  }
});

test('위에 다른 화면이 쌓이면 아래 화면의 영상은 내려놓는다(SOMA-699)', () => {
  for (const file of ['app/challenge-upload.tsx', 'app/upload.tsx']) {
    const src = read(file);
    assert.match(src, /const focused = useIsFocused\(\);/, file);
    assert.match(src, /useVideoPlayer\(sourceWhileFocused\(/, file);
  }
  const play = read('app/challenge-play.tsx');
  assert.match(play, /if \(focused\) return;\s*player\.pause\(\);\s*void player\.replaceAsync\(null\)/);
});

test('안드로이드 앱 메모리 한도를 넓힌다 — 응급처치(SOMA-699)', () => {
  const plugin = read('plugins/with-large-heap.js');
  assert.match(plugin, /app\.\$\['android:largeHeap'\] = 'true';/);
  const plugins = JSON.parse(read('app.json')).expo.plugins;
  assert.ok(plugins.includes('./plugins/with-large-heap.js'));
});

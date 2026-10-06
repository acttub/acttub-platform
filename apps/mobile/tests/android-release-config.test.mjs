import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');

test('SOMA-584: 서버 저녁 리마인드를 받는 최소 앱 버전은 0.1.2다', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(app.expo.version, '0.1.2');
});

// Play Console "DEX 코드 최적화 낮음" — 릴리스 빌드에 R8(축소·최적화)과 리소스 축소를 켠다 (SOMA-494).
// 대본 리딩 음성 엔진(onnxruntime)은 JNI 가 자바 클래스를 이름으로 찾으므로 R8 이 지우지 않게 보존한다.
test('안드로이드 릴리스 빌드는 R8·리소스 축소를 켜고 onnxruntime 클래스를 보존한다', () => {
  const plugins = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo.plugins;
  const [, props] = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
  assert.equal(props.android.enableProguardInReleaseBuilds, true);
  assert.equal(props.android.enableShrinkResourcesInReleaseBuilds, true);
  assert.match(props.android.extraProguardRules, /-keep class ai\.onnxruntime\.\*\* \{ \*; \}/);
});

test('expo-audio 의 포그라운드 서비스·권한을 병합 매니페스트에서 뺀다 — Play 포그라운드 서비스 선언(동영상 필수)이 필요 없게', () => {
  const appJson = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  const plugins = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(plugins.includes('./plugins/with-remove-audio-foreground-service.js'));
  const plugin = readFileSync(path.join(appRoot, 'plugins/with-remove-audio-foreground-service.js'), 'utf8');
  assert.match(plugin, /FOREGROUND_SERVICE_MEDIA_PLAYBACK/);
  assert.match(plugin, /expo\.modules\.audio\.service\.AudioControlsService/);
  assert.match(plugin, /expo\.modules\.audio\.service\.AudioRecordingService/);
  assert.match(plugin, /'tools:node': 'remove'/);
});

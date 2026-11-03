import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');

test('SOMA-584: 앱 버전은 서버 저녁 리마인드를 받는 최소 버전(0.1.2) 이상이다', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const [major, minor, patch] = app.expo.version.split('.').map(Number);
  assert.ok(major > 0 || minor > 1 || (minor === 1 && patch >= 2), app.expo.version);
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

test('expo-audio 의 포그라운드 서비스는 빼고, 안드로이드 리딩 서비스는 재생(mediaPlayback)만 쓴다', () => {
  const appJson = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  const plugins = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(plugins.includes('./plugins/with-remove-audio-foreground-service.js'));
  const plugin = readFileSync(path.join(appRoot, 'plugins/with-remove-audio-foreground-service.js'), 'utf8');
  assert.match(plugin, /expo\.modules\.audio\.service\.AudioControlsService/);
  assert.match(plugin, /expo\.modules\.audio\.service\.AudioRecordingService/);
  assert.match(plugin, /'tools:node': 'remove'/);
  // 1.1.1 출시 전(11/3 사용자 결정): 리딩 백그라운드 재생을 iOS·안드로이드 모두 뺀다. 안드로이드 리딩 모듈(재생 포그라운드
  // 서비스·Live Update 알림 권한)을 연결하지 않고 재생 서비스 권한도 막는다 — Play 포그라운드 서비스 선언(사용 장면 동영상 필수) 대상이 안 생긴다.
  const moduleConfig = JSON.parse(readFileSync(path.join(appRoot, 'modules/reading-live/expo-module.config.json'), 'utf8'));
  assert.deepEqual(moduleConfig.platforms, ['apple']);
  assert.equal(moduleConfig.android, undefined);
  const blocked = appJson.expo.android.blockedPermissions;
  assert.ok(blocked.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'));
  assert.ok(blocked.includes('android.permission.FOREGROUND_SERVICE_MICROPHONE'));
});

// 사진첩 저장은 쓰기 전용이라 안드로이드 13+ 는 읽기 권한이 필요 없다. 남으면 Play 사진·동영상 권한 선언 대상이 된다.
test('안드로이드는 사진·동영상 읽기 권한을 막는다', () => {
  const blocked = JSON.parse(readFileSync(path.join(appRoot, 'app.json'), 'utf8')).expo.android.blockedPermissions;
  assert.ok(blocked.includes('android.permission.READ_MEDIA_VIDEO'));
  assert.ok(blocked.includes('android.permission.READ_MEDIA_VISUAL_USER_SELECTED'));
});

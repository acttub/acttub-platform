import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('안드로이드 헤더 오른쪽 버튼을 다시 붙일 때 옛 부모에서 먼저 떼어 앱이 꺼지지 않는다(SOMA-822)', () => {
  // Crashlytics: ScreenStackHeaderConfig.onUpdate 에서 「The specified child already has a parent」로 꺼졌다.
  // 0.1.3~0.1.5, /coach 와 /reading/detail 처럼 headerRight 를 쓰는 화면으로 돌아올 때. 라이브러리 최신판(4.30)도 그대로라 패치로 막는다.
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.postinstall ?? '', /patch-package/);
  assert.ok(pkg.devDependencies?.['patch-package'] ?? pkg.dependencies?.['patch-package']);
  const version = pkg.dependencies['react-native-screens'].replace(/^[~^]/, '');
  const name = readdirSync(new URL('../patches/', import.meta.url)).find((f) => f.startsWith('react-native-screens+'));
  assert.equal(name, `react-native-screens+${version}.patch`);
  const patch = read(`patches/${name}`);
  assert.match(patch, /ScreenStackHeaderConfig\.kt/);
  assert.match(patch, /\+\s*\(view\.parent as\? android\.view\.ViewGroup\)\?\.removeView\(view\)\n\s+toolbar\.addView\(view\)/);
});

test('iOS 음성 인식은 마이크 하드웨어 형식이 비어 있으면 꺼지지 않고 「입력 사용 중」 오류로 끝난다(SOMA-822)', () => {
  // Crashlytics iOS 0.1.5: AVAudioEngine connect 에서 「Input HW format is invalid」로 꺼졌다(리딩 실행 중, 10/24).
  // 출력 형식만 보는 기존 검사를 통과해도 하드웨어 입력이 비면 connect 가 Objective-C 예외를 던져 Swift 에서 못 잡는다.
  const pkg = JSON.parse(read('package.json'));
  const version = pkg.dependencies['expo-speech-recognition'].replace(/^[~^]/, '');
  const patch = read(`patches/expo-speech-recognition+${version}.patch`);
  assert.match(patch, /ExpoSpeechRecognizer\.swift/);
  const guards = patch.match(/^\+.*audioInputIsBusy\(inputNode\.inputFormat\(forBus: 0\)\)/gm) ?? [];
  // 처음 켤 때와 블루투스 등 경로가 바뀌어 다시 켤 때 두 곳 모두
  assert.equal(guards.length, 2);
});

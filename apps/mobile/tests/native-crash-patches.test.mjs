import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

// SOMA-1091: 안드로이드 1.1.1 크래시 두 가지를 라이브러리 패치로 막는다.

test('문서 선택: 안드로이드는 소스에서 빌드한다 — 미리 빌드된 AAR 을 쓰면 소스 패치가 빌드에 안 들어간다', () => {
  const autolinking = JSON.parse(read('package.json')).expo.autolinking.android;
  assert.ok(autolinking.buildFromSource.includes('expo-document-picker'));
});

test('문서 선택: 결과는 꺼낸 promise 하나로 한 번만 처리하고, 이미 처리됐으면 앱을 끄지 않는다', () => {
  const patch = read('patches/expo-document-picker+58.0.5.patch');
  assert.match(patch, /\+\s+val promise = pendingPromise \?: return@OnActivityResult\n\+\s+pendingPromise = null/);
  assert.match(patch, /\+\s+private fun rejectQuietly\(/);
  assert.match(patch, /-\s+pendingPromise\?\.resolve\(result\)/);
});

test('음성 인식 녹음기: 초기화 안 된 녹음기는 들고 있지 않고, 멈출 때 상태를 본다', () => {
  const patch = read('patches/expo-speech-recognition+56.0.1.patch');
  assert.match(patch, /ExpoAudioRecorder\.kt/);
  assert.match(patch, /-\s+audioRecorder = this\n/);
  assert.match(patch, /\+\s+release\(\)\n\s+return\n\s+\}\n\+\s+audioRecorder = this/);
  assert.match(patch, /\+\s+if \(recorder\.state == AudioRecord\.STATE_INITIALIZED\)/);
  // iOS 오디오 엔진 예외 패치(SOMA-916)는 그대로 둔다.
  assert.match(patch, /ExpoSpeechObjCCatcher/);
});

test('리딩 목소리(onnxruntime): RN 0.88 에서 빠진 RCTCxxBridge 대신 브리지의 runtime 을 프로토콜로 읽는다', () => {
  // 1.24.3(최신)은 RCTCxxBridge 로 JSI 런타임을 꺼내 RN 0.88 에서 iOS 컴파일이 멈췄다(SOMA-1177).
  const version = JSON.parse(read('package.json')).dependencies['onnxruntime-react-native'].replace(/^[~^]/, '');
  const patch = read(`patches/onnxruntime-react-native+${version}.patch`);
  assert.match(patch, /-\s+RCTCxxBridge\* cxxBridge = \(RCTCxxBridge\*\)_bridge;/);
  assert.match(patch, /\+- \(void \*\)runtime;/);
  assert.match(patch, /\+\s+auto jsiRuntime = \(facebook::jsi::Runtime\*\)\[\(id<OnnxruntimeJSIRuntimeProvider>\)_bridge runtime\];/);
  // 설치된 소스에 실제로 들어갔는지 본다.
  const installed = read('node_modules/onnxruntime-react-native/ios/OnnxruntimeModule.mm');
  assert.doesNotMatch(installed, /RCTCxxBridge\*/);
});

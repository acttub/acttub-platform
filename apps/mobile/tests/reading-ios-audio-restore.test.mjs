import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

globalThis.__iosAudioTest = { os: 'ios', modes: [], fails: false };
const fakes = {
  'expo-audio': `const s = globalThis.__iosAudioTest;
    export async function setAudioModeAsync(mode) { s.modes.push(mode); if (s.fails) throw new Error('session busy'); }`,
  'react-native': `export const Platform = { get OS() { return globalThis.__iosAudioTest.os; } };`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (fakes[specifier] && context.parentURL?.endsWith('/reading/ios-audio-restore.ts')) {
      return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { keepReadingInBackground, restorePlaybackAudio } = await import('../lib/reading/ios-audio-restore.ts');
const s = globalThis.__iosAudioTest;

test('iOS 는 인식이 끝나면 오디오를 일반 재생으로 되돌리고, 실패해도 던지지 않는다', async () => {
  restorePlaybackAudio();
  s.fails = true;
  restorePlaybackAudio();
  await new Promise((resolve) => setImmediate(resolve));
  // 배경으로 가도 멈추지 않는 리딩 설정(SOMA-802)은 되돌릴 때도 유지한다.
  const restored = { playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: true, allowsBackgroundRecording: true };
  assert.deepEqual(s.modes, [restored, restored]);
});

test('안드로이드는 오디오 모드를 건드리지 않는다', () => {
  s.os = 'android';
  s.modes = [];
  restorePlaybackAudio();
  assert.deepEqual(s.modes, []);
});

test('리딩을 시작하면 배경에서도 재생을 멈추지 않게 하고, 녹음 서비스는 iOS 만 expo-audio 에 맡긴다(SOMA-802)', async () => {
  s.fails = false;
  s.modes = [];
  s.os = 'android';
  keepReadingInBackground();
  s.os = 'ios';
  s.fails = true;
  keepReadingInBackground();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(s.modes, [
    { playsInSilentMode: true, shouldPlayInBackground: true, allowsBackgroundRecording: false },
    { playsInSilentMode: true, shouldPlayInBackground: true, allowsBackgroundRecording: true },
  ]);
});

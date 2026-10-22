import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { READING_STT_IOS_CATEGORY } from '../lib/reading/ios-audio.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// SOMA-710: 음성 인식의 기본 오디오 모드(measurement)는 iOS 재생 보정과 마이크 자동 음량을 꺼서 상대역 목소리·녹음이 작아진다.

test('reading.ios-audio: 음성 인식은 측정 모드가 아니라 일반 모드로, 스피커로 내보낸다', () => {
  assert.deepEqual(READING_STT_IOS_CATEGORY, {
    category: 'playAndRecord',
    categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
    mode: 'default',
  });
  const stt = read('hooks/use-reading-stt.ts');
  assert.match(stt, /ExpoSpeechRecognitionModule\.start\(\{[\s\S]*?iosCategory: READING_STT_IOS_CATEGORY,/);
});

test('reading.ios-audio: 인식이 끝나거나 끊기면 오디오를 일반 재생으로 되돌린다', () => {
  const stt = read('hooks/use-reading-stt.ts');
  assert.match(stt, /const finishNow = useCallback\(\(value: string\) => \{[\s\S]*?restorePlaybackAudio\(\);/);
  assert.match(stt, /ExpoSpeechRecognitionModule\.abort\(\);\s*\} catch \{\}\s*restorePlaybackAudio\(\);/);
  const lib = read('lib/reading/ios-audio-restore.ts');
  assert.match(lib, /setAudioModeAsync\(\{ playsInSilentMode: true, allowsRecording: false, \.\.\.background\(\) \}\)/);
  assert.match(lib, /if \(Platform\.OS !== 'ios'\) return;/);
});

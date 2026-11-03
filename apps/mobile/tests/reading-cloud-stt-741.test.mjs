import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hook = readFileSync(new URL('../hooks/use-reading-stt.ts', import.meta.url), 'utf8');

test('reading.stt: 기기 안 인식만 요구하지 않는다 — 기기 안 한국어 인식기가 결과를 주지 않아 리딩이 멈췄다(SOMA-741)', () => {
  assert.match(hook, /requiresOnDeviceRecognition: false/);
  assert.doesNotMatch(hook, /requiresOnDeviceRecognition: true/);
});

test('reading.stt: 인식기가 알린 말 끝으로도 넘긴다 — 일반 인식기는 음량 신호를 주지 않는다(SOMA-741)', () => {
  const handler = hook.slice(hook.indexOf("useSpeechRecognitionEvent('speechend'"), hook.indexOf("useSpeechRecognitionEvent('audioend'"));
  assert.match(handler, /if \(!active\.current\) return;/);
  // 받아쓴 글이 없으면(잡음·글보다 먼저 온 말 끝) 여기서는 걸지 않는다 — 글이 오면 result 가 말 끝을 건다(SOMA-1037).
  assert.match(handler, /if \(!text\.current\.trim\(\)\) \{[\s\S]*?return;\n\s*\}\n\s*armSpeechEnd\('speechend'\);/, '받아쓴 글이 없으면(잡음) 넘기지 않는다');
  const arm = hook.slice(hook.indexOf('const armSpeechEnd'), hook.indexOf("useSpeechRecognitionEvent('result'"));
  assert.match(arm, /callbacks\.current\?\.onEvent\('speech_end'\)/);
  // 기다리는 시간은 서버 설정을 쓰는 순간 읽는다(SOMA-939) — 기본값 1300ms 는 app-config 가 잠근다.
  assert.match(arm, /setTimeout\([\s\S]*?getAppConfig\(\)\.reading\.speechEndGraceMs\)/, '말 끝 뒤 조금 더 기다렸다가 넘긴다');
  // 아이폰 인식기는 말 끝을 주지 않는다 — 받아쓴 글이 있는 결과가 끊기면 말 끝으로 본다(SOMA-801).
  // 안드로이드도 말 끝 신호가 글보다 먼저 와 버려지거나 소음으로 침묵을 못 재서 줄이 멈췄다 — 두 플랫폼 모두 그렇게 본다(SOMA-1037).
  assert.match(hook, /if \(whole\) armSpeechEnd\('result'\);/);
  assert.doesNotMatch(hook, /Platform\.OS === 'ios' && whole\) armSpeechEnd/);
  assert.match(hook, /export const SPEECH_END_GRACE_MS = DEFAULT_APP_CONFIG\.reading\.speechEndGraceMs;/);
  assert.match(hook, /useSpeechRecognitionEvent\('speechstart', \(\) => \{\s*cancelSpeechEnd\(\);/, '기다리는 동안 다시 말하면 취소');
  assert.match(hook, /useSpeechRecognitionEvent\('speechstart'[\s\S]*?onEvent\('speech_start'\)/);
});

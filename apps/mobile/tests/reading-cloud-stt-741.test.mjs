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
  assert.match(handler, /if \(!active\.current \|\| !text\.current\.trim\(\)\) return;/, '받아쓴 글이 없으면(잡음) 넘기지 않는다');
  assert.match(handler, /armSpeechEnd\(\)/);
  const arm = hook.slice(hook.indexOf('const armSpeechEnd'), hook.indexOf("useSpeechRecognitionEvent('result'"));
  assert.match(arm, /callbacks\.current\?\.onEvent\('speech_end'\)/);
  // 기다리는 시간은 서버 설정을 쓰는 순간 읽는다(SOMA-939) — 기본값 1300ms 는 app-config 가 잠근다.
  assert.match(arm, /setTimeout\([\s\S]*?getAppConfig\(\)\.reading\.speechEndGraceMs\)/, '말 끝 뒤 조금 더 기다렸다가 넘긴다');
  // 아이폰 인식기는 말 끝을 주지 않는다 — 받아쓴 글이 있는 결과가 끊기면 말 끝으로 본다(SOMA-801).
  assert.match(hook, /Platform\.OS === 'ios' && whole\) armSpeechEnd\(\)/);
  assert.match(hook, /export const SPEECH_END_GRACE_MS = DEFAULT_APP_CONFIG\.reading\.speechEndGraceMs;/);
  assert.match(hook, /useSpeechRecognitionEvent\('speechstart', \(\) => \{\s*cancelSpeechEnd\(\);/, '기다리는 동안 다시 말하면 취소');
  assert.match(hook, /useSpeechRecognitionEvent\('speechstart'[\s\S]*?onEvent\('speech_start'\)/);
});

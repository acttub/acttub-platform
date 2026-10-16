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
  assert.match(handler, /callbacks\.current\?\.onEvent\('speech_end'\)/);
  assert.match(hook, /useSpeechRecognitionEvent\('speechstart'[\s\S]*?onEvent\('speech_start'\)/);
});

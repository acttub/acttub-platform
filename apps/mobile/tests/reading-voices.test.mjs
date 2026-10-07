import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoVoiceOf,
  devicePitchFor,
  normalizePresetValue,
  shownVoices,
  voiceChanges,
} from '../lib/reading/voices.ts';

const ch = (id, name, voice_preset = null, voice = 'F1') => ({ id, name, order: 0, voice_preset, voice, dialogue_count: 1 });

// 서버 상세 그대로의 배역 넷. 둘째가 F3 고정이라 자동 순환은 니나 F1 · 아르카지나 M1 · 소린 F2(서버 VoiceAssignment).
const SAVED = [ch('a', '니나', null, 'F1'), ch('b', '트레플레프', 'F3', 'F3'), ch('c', '아르카지나', null, 'M1'), ch('d', '소린', null, 'F2')];

test('reading.cast: 목소리 정하기는 고친 것이 없으면 서버가 준 목소리를 그대로 보인다', () => {
  assert.deepEqual(shownVoices(SAVED, {}), { a: 'F1', b: 'F3', c: 'M1', d: 'F2' });
  assert.deepEqual(shownVoices(SAVED, { a: null, b: 'F3' }), { a: 'F1', b: 'F3', c: 'M1', d: 'F2' }, '저장된 값과 같은 선택은 고친 것이 아니다');
  assert.deepEqual(shownVoices([ch('a', '니나', null, 'M5')], {}), { a: 'M5' }, '기기가 다시 세지 않는다');
});

test('reading.cast: 저장 전에 고정값을 풀거나 더하면 뒤 배역의 자동 목소리가 순환대로 밀린다', () => {
  assert.deepEqual(shownVoices(SAVED, { b: null }), { a: 'F1', b: 'M1', c: 'F2', d: 'M2' });
  assert.deepEqual(shownVoices(SAVED, { a: 'M4' }), { a: 'M4', b: 'F3', c: 'F1', d: 'M1' });
  assert.deepEqual(shownVoices([ch('a', '니나', 'ELEVEN', 'F1'), ch('b', '트레플레프', null, 'M1')], { b: 'M2' }), { a: 'F1', b: 'M2' }, '기기가 모르는 값은 자동');
});

test('reading.cast: 빈 값·"자동"은 null이다', () => {
  assert.equal(normalizePresetValue('auto'), null);
  assert.equal(normalizePresetValue(''), null);
  assert.equal(normalizePresetValue(' F2 '), 'F2');
});

test('reading.cast: 기기 음성 대체는 프리셋마다 정해진 높낮이를 쓴다(여성 프리셋이 더 높다)', () => {
  assert.ok(devicePitchFor('F1') > devicePitchFor('M1'));
  assert.equal(devicePitchFor('unknown'), 1);
});

// 아래 기대값은 서버 VoiceAssignmentTest(A1 #508)의 입력·기대값 그대로다. 저장 전 선택이 있어야 shownVoices 가 기기 순환을 탄다.
const auto = (n) => Array.from({ length: n }, (_, i) => ch(`c${i}`, `배역${i}`, null));

test('reading.cast: 배역 넷에서 둘째를 F3으로 고정하면 F1·F3·M1·F2다(cast.md 검증, 저장 전 선택)', () => {
  assert.deepEqual(shownVoices(auto(4), { c1: 'F3' }), { c0: 'F1', c1: 'F3', c2: 'M1', c3: 'F2' });
  assert.equal(autoVoiceOf(auto(4), { c1: 'F3' }, 'c3'), 'F2', '서버 「고정값은 순환에서 빠지니 소린은 셋째(F2) 자리」');
});

test('reading.cast: 기기 순환은 서버 VoiceAssignment 와 같은 답을 낸다', () => {
  assert.deepEqual(shownVoices(auto(3), { c0: 'M3' }), { c0: 'M3', c1: 'F1', c2: 'M1' }, '서버 presets(M3, null, null)');
  const odd = [ch('c0', '니나', 'ELEVEN'), ch('c1', '트레플레프'), ch('c2', '아르카지나')];
  assert.deepEqual(shownVoices(odd, { c1: 'M2', c2: 'M2' }), { c0: 'F1', c1: 'M2', c2: 'M2' }, '서버 presets(ELEVEN, M2, M2)');
  const eleven = [...auto(10), ch('c10', '배역10', 'M5')];
  assert.deepEqual(Object.values(shownVoices(eleven, { c10: null })), ['F1', 'M1', 'F2', 'M2', 'F3', 'M3', 'F4', 'M4', 'F5', 'M5', 'F1'], '서버 자동 열하나');
  assert.equal(autoVoiceOf(eleven, {}, 'c10'), 'F1', '열한째를 자동으로 돌리면 F1로 돌아간다');
});

test('reading.cast: 목소리 시트의 「자동 (지금 X)」 — 그 배역을 자동으로 돌리면 받을 목소리', () => {
  assert.equal(autoVoiceOf(SAVED, {}, 'b'), 'M1', '고정값을 풀면 배역 순서 둘째 자리 목소리');
  assert.equal(autoVoiceOf(SAVED, {}, 'c'), 'M1', '이미 자동이면 서버 값');
  assert.equal(autoVoiceOf(SAVED, { a: 'M4' }, 'd'), 'M1', '니나를 고정하면 소린이 한 자리 당겨진다');
});

test('reading.cast: [저장]은 저장된 값과 달라진 배역만 보낸다', () => {
  const cast = [ch('a', '니나'), ch('b', '트레플레프', 'M2'), ch('c', '소린')];
  assert.deepEqual(voiceChanges(cast, {}), []);
  assert.deepEqual(voiceChanges(cast, { a: null, b: 'M2' }), [], '고른 값이 저장된 값과 같으면 보내지 않는다');
  assert.deepEqual(voiceChanges(cast, { a: 'F4', b: null }), [
    { id: 'a', voice_preset: 'F4' },
    { id: 'b', voice_preset: null },
  ]);
});

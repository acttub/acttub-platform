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

// SOMA-670: 서버가 대본에서 뽑은 성별·나이대로 자동 목소리를 고른다. 앱은 저장 전 선택을 미리 보이려고 같은 규칙을 센다.
const cg = (id, gender, age_band, voice_preset = null) => ({ id, name: id, order: 0, voice_preset, voice: 'F1', dialogue_count: 1, gender, age_band });

test('reading.cast: 성별·나이대가 있으면 그에 맞는 목소리를 겹치지 않게 고른다(SOMA-670)', () => {
  const cast = [cg('grandpa', 'm', 'senior'), cg('girl', 'f', 'young'), cg('mom', 'f', 'adult'), cg('boy', 'm', 'young'), cg('grandma', 'f', 'senior')];
  assert.deepEqual(shownVoices(cast, { grandpa: null, girl: null, mom: null, boy: null, grandma: 'F5' }), {
    grandpa: 'M5', girl: 'F2', mom: 'F1', boy: 'M1', grandma: 'F5',
  });
  // 고정한 목소리는 쓴 것으로 친다 — 노년 할머니가 F5 를 쥐었으니 다른 노년 여성은 다음 후보 F3.
  const two = [cg('a', 'f', 'senior', 'F5'), cg('b', 'f', 'senior', 'M2')];
  assert.equal(autoVoiceOf(two, {}, 'b'), 'F3');
  // 아이는 청년 목록을 쓴다(자동으로 돌렸을 때 받을 목소리).
  assert.equal(autoVoiceOf([cg('kid', 'm', 'child', 'M4')], {}, 'kid'), 'M1');
  // 나이를 모르면 성별 기본 목록.
  assert.equal(autoVoiceOf([cg('x', 'm', null, 'M4')], {}, 'x'), 'M1');
});

test('reading.cast: 같은 성별 목소리를 다 쓰면 목록 첫 목소리를 다시 쓴다', () => {
  const men = Array.from({ length: 6 }, (_, i) => cg(`m${i}`, 'm', 'adult', i === 0 ? 'F1' : null));
  assert.deepEqual(Object.values(shownVoices(men, { m0: null })), ['M3', 'M4', 'M2', 'M1', 'M5', 'M3']);
});

test('reading.cast: 성별을 모르면 예전 순환이되, 이미 쓴 목소리는 건너뛴다', () => {
  const mixed = [cg('a', 'f', 'young', 'M2'), cg('b', null, null), cg('c', null, null)];
  // a 가 F2 를 쓰므로 순환은 F1, M1 (F2 를 건너뛸 차례가 아님) → b F1, c M1.
  assert.deepEqual(shownVoices(mixed, { a: null }), { a: 'F2', b: 'F1', c: 'M1' });
  const pinnedF1 = [cg('a', null, null, 'F1'), cg('b', null, null, 'M2')];
  assert.equal(autoVoiceOf(pinnedF1, {}, 'b'), 'M1', '고정한 F1 은 건너뛴다');
});

// SOMA-670: M1·F5 같은 코드 대신 목소리 느낌으로 보인다. 저장 값은 그대로 코드다.
import { readFileSync } from 'node:fs';
const readSrc = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('reading.cast: 목소리 정하기는 코드 대신 이름을 보이고, 나이 순서로 줄 세운다', () => {
  const ko = readSrc('locales/ko.ts');
  for (const [code, name] of [
    ['M1', '밝은 청년'], ['M4', '부드러운 청년'], ['M3', '차분한 중년'], ['M2', '낮은 중년'], ['M5', '묵직한 노년'],
    ['F2', '밝은 소녀'], ['F4', '맑은 청년'], ['F1', '또렷한 성인'], ['F3', '차분한 중년'], ['F5', '따뜻한 노년'],
  ]) {
    assert.match(ko, new RegExp(`${code}: '${name}'`), code);
  }
});

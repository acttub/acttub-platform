import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_ROTATION,
  VOICE_PRESETS,
  assignVoices,
  autoVoiceOf,
  devicePitchFor,
  isKnownPreset,
  normalizePresetValue,
  voiceChanges,
} from '../lib/reading/voices.ts';

const ch = (id, name, voice_preset = null) => ({ id, name, order: 0, voice_preset, dialogue_count: 1 });

test('reading.cast: 자동 목소리는 대본의 모든 배역에 등장 순서로 F1·M1·F2·M2를 돌려 주고 내 배역만 뺀다', () => {
  const characters = [ch('a', '니나'), ch('b', '트레플레프'), ch('c', '아르카지나'), ch('d', '소린')];
  const voices = assignVoices(characters, ['a']);
  assert.deepEqual(voices, { b: 'M1', c: 'F2', d: 'M2' });
  assert.deepEqual(AUTO_ROTATION, ['F1', 'M1', 'F2', 'M2', 'F3', 'M3', 'F4', 'M4', 'F5', 'M5']);
});

test('reading.cast: 내 배역을 바꿔도 다른 배역의 자동 목소리는 그대로다(목소리 정하기 화면에 보인 값 = 연습 때 값)', () => {
  const characters = [ch('a', '니나'), ch('b', '트레플레프'), ch('c', '아르카지나'), ch('d', '소린')];
  assert.deepEqual(assignVoices(characters, ['b']), { a: 'F1', c: 'F2', d: 'M2' });
  assert.deepEqual(assignVoices(characters, ['a', 'b']), { c: 'F2', d: 'M2' });
});

test('reading.cast: "니나"를 M3으로 바꾸면 니나는 M3, 나머지는 자동 순환이고 다른 배역의 값은 그대로다', () => {
  const characters = [ch('a', '니나', 'M3'), ch('b', '트레플레프'), ch('c', '아르카지나')];
  assert.deepEqual(assignVoices(characters, ['b']), { a: 'M3', c: 'M1' });
  assert.equal(characters[1].voice_preset, null);
  assert.equal(characters[2].voice_preset, null);
});

test('reading.cast: 모든 배역을 내 배역으로 고르면 상대역이 없다', () => {
  const characters = [ch('a', '니나'), ch('b', '트레플레프')];
  assert.deepEqual(assignVoices(characters, ['a', 'b']), {});
});

test('reading.cast: 기기가 모르는 프리셋 값은 자동으로 다루고, 같은 프리셋을 두 배역에 줄 수 있다', () => {
  const characters = [ch('a', '니나', 'ELEVEN'), ch('b', '트레플레프', 'M2'), ch('c', '아르카지나', 'M2')];
  assert.equal(isKnownPreset('ELEVEN'), false);
  assert.deepEqual(assignVoices(characters, []), { a: 'F1', b: 'M2', c: 'M2' });
  assert.equal(VOICE_PRESETS.length, 10);
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

test('reading.cast: 목소리 시트의 「자동 (지금 X)」 — 그 배역을 자동으로 돌리면 받을 목소리', () => {
  const cast = [ch('a', '니나'), ch('b', '트레플레프', 'F3'), ch('c', '아르카지나'), ch('d', '소린')];
  assert.equal(autoVoiceOf(cast, 'b'), 'M1', '고정값을 풀면 등장 순서 둘째 자리 목소리');
  assert.equal(autoVoiceOf(cast, 'd'), 'F2', '고정값은 순환에서 빠지니 소린은 넷째(M2)가 아니라 셋째(F2) 자리');
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

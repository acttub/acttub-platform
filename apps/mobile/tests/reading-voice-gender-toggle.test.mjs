import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendedVoice, shownVoices, switchGender, voiceChoice } from '../lib/reading/voices.ts';

const ch = (id, gender, voice_preset, voice, age_band = 'young') => ({ id, name: id, order: 0, gender, age_band, voice_preset, voice, dialogue_count: 1 });
const PAIR = [ch('seoyeon', 'f', null, 'F2'), ch('junho', 'm', null, 'M1')];

test('reading.cast: 남녀를 바꾸면 그 성별의 추천 목소리가 골라진다(10-27)', () => {
  assert.deepEqual(switchGender(PAIR, {}, 'junho'), { junho: 'F4' }, '서연이 F2 를 쓰고 있어 청년 여성 다음 목소리');
  assert.deepEqual(switchGender(PAIR, {}, 'seoyeon'), { seoyeon: 'M4' }, '준호가 M1 을 쓰고 있어 청년 남성 다음 목소리');
});

test('reading.cast: 원래 성별로 되돌리면 자동 목소리(null)로 돌아간다', () => {
  assert.deepEqual(switchGender(PAIR, { junho: 'F4' }, 'junho'), { junho: null });
});

test('reading.cast: 남녀를 바꿔도 다른 배역이 듣던 목소리는 그대로다 — 밀릴 배역은 지금 목소리로 고정한다', () => {
  const adults = [ch('a', 'f', null, 'F1', 'adult'), ch('b', 'f', null, 'F3', 'adult')];
  const patch = switchGender(adults, {}, 'a');
  assert.deepEqual(patch, { a: 'M3', b: 'F3' });
  assert.deepEqual(shownVoices(adults, patch), { a: 'M3', b: 'F3' });
});

test('reading.cast: 다른 배역이 고정한 목소리는 추천에서 건너뛴다', () => {
  const fixed = [ch('seoyeon', 'f', 'F4', 'F4'), ch('junho', 'm', null, 'M1')];
  assert.equal(recommendedVoice(fixed, {}, 'junho', 'f'), 'F2');
  assert.equal(recommendedVoice(fixed, { seoyeon: 'F2' }, 'junho', 'f'), 'F4');
});

test('reading.cast: 메뉴에서 자동과 같은 목소리를 고르면 자동으로 둔다', () => {
  assert.deepEqual(voiceChoice(PAIR, {}, 'seoyeon', 'F2'), { seoyeon: null });
  assert.deepEqual(voiceChoice(PAIR, {}, 'seoyeon', 'F1'), { seoyeon: 'F1' });
});

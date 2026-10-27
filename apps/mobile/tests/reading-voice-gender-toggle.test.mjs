import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendedVoice, switchGender, voiceChoice } from '../lib/reading/voices.ts';

const ch = (id, gender, voice_preset, voice) => ({ id, name: id, order: 0, gender, age_band: 'young', voice_preset, voice, dialogue_count: 1 });
const PAIR = [ch('seoyeon', 'f', null, 'F2'), ch('junho', 'm', null, 'M1')];

test('reading.cast: 남녀를 바꾸면 그 성별의 추천 목소리가 골라진다(10-27)', () => {
  assert.equal(switchGender(PAIR, {}, 'junho'), 'F4', '서연이 F2 를 쓰고 있어 청년 여성 다음 목소리');
  assert.equal(switchGender(PAIR, {}, 'seoyeon'), 'M4', '준호가 M1 을 쓰고 있어 청년 남성 다음 목소리, 준호는 M1 그대로');
});

test('reading.cast: 원래 성별로 되돌리면 자동 목소리(null)로 돌아간다', () => {
  assert.equal(switchGender(PAIR, { junho: 'F4' }, 'junho'), null);
});

test('reading.cast: 다른 배역이 고정한 목소리는 추천에서 건너뛴다', () => {
  const fixed = [ch('seoyeon', 'f', 'F4', 'F4'), ch('junho', 'm', null, 'M1')];
  assert.equal(recommendedVoice(fixed, {}, 'junho', 'f'), 'F2');
  assert.equal(recommendedVoice(fixed, { seoyeon: 'F2' }, 'junho', 'f'), 'F4');
});

test('reading.cast: 메뉴에서 자동과 같은 목소리를 고르면 자동으로 둔다', () => {
  assert.equal(voiceChoice(PAIR, {}, 'seoyeon', 'F2'), null);
  assert.equal(voiceChoice(PAIR, {}, 'seoyeon', 'F1'), 'F1');
});

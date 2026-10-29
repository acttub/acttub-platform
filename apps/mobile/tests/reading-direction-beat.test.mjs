import assert from 'node:assert/strict';
import test from 'node:test';

import { BEAT_MAX_LINES, BEAT_MAX_MS, BEAT_MIN_MS, beatMs, directionsBefore } from '../lib/reading/direction-beat.ts';

const d = (role, text) => ({ type: 'dialogue', role, text });
const dir = (text) => ({ type: 'direction', text });
const scene = (text) => ({ type: 'scene', text });

// 「메카로 가는 길」 앞부분 모양 — 장면 머리, 무대 설명 지문 셋, 그 뒤 대사.
const lines = [
  scene('1 막'),
  dir('뉴 베데스다의 자그마한 카루 마을에 위치한 어느 집.'),
  dir('미스 헬렌이 침실에 있다.'),
  dir('엘사 등장.'),
  d('엘사', '아직은 차가 얼어붙을 정도로 춥진 않죠?'),
  d('미스 헬렌', '그럼, 그럴 위험은 없어.'),
  dir('침묵'),
  d('미스 헬렌', '내 더운 물 가져올께.'),
  dir('미스 헬렌 퇴장.'),
  scene('2 막'),
  dir('같은 집. 밤.'),
  d('마리우스', '미스 헬렌! 어둔 데서 혼자 있소?'),
];

test('SOMA-937: 대사 바로 앞의 지문·장면을 원래 순서로 — 첫 대사 앞 무대 설명도', () => {
  assert.deepEqual(directionsBefore(lines, 4), [0, 1, 2, 3]);
  assert.deepEqual(directionsBefore(lines, 7), [6]);
});

test('SOMA-937: 바로 앞이 대사면 지문 멈춤이 없다', () => {
  assert.deepEqual(directionsBefore(lines, 5), []);
  assert.deepEqual(directionsBefore(lines, 0), []);
});

test('SOMA-937: 장면 머리에서 멈춰 앞 장면의 지문을 끌어오지 않는다', () => {
  assert.deepEqual(directionsBefore(lines, 11), [9, 10]);
});

test('SOMA-937: 지문이 많으면 가까운 줄부터 정해진 수만', () => {
  const many = [...Array.from({ length: BEAT_MAX_LINES + 3 }, (_, i) => dir(`지문 ${i}`)), d('A', '대사')];
  const got = directionsBefore(many, many.length - 1);
  assert.equal(got.length, BEAT_MAX_LINES);
  assert.equal(got.at(-1), many.length - 2);
  assert.deepEqual(got, [...got].sort((a, b) => a - b));
});

test('SOMA-937: 머무는 시간은 글 길이에 따라 늘되 최소·최대 안', () => {
  assert.equal(beatMs(['침묵']), BEAT_MIN_MS);
  assert.equal(beatMs(['가'.repeat(500)]), BEAT_MAX_MS);
  const mid = beatMs(['가'.repeat(60)]);
  assert.ok(mid > BEAT_MIN_MS && mid < BEAT_MAX_MS);
  assert.ok(beatMs(['가'.repeat(40), '가'.repeat(40)]) > beatMs(['가'.repeat(40)]));
});

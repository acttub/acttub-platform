import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SILENCE_MS,
  advanceDecision,
  mergeTranscript,
} from '../lib/reading/auto-advance.ts';

/**
 * 내 차례가 끝났는지 판정한다 (SOMA-549).
 *
 * <p>말을 자르는 것이 못 넘어가는 것보다 나쁘다 — 대사 중간에 넘어가면 그 줄을 다시 해야 하고,
 * 안 넘어가면 버튼을 누르면 된다. 그래서 애매하면 기다리는 쪽으로 판정한다.
 */

test('말을 시작하지도 않았으면 넘어가지 않는다', () => {
  const d = advanceDecision({ heard: '', lastHeardAt: null, now: 10_000, ended: false });
  assert.equal(d.advance, false);
  assert.equal(d.reason, 'not_started');
});

test('말하는 도중에는 넘어가지 않는다', () => {
  const d = advanceDecision({ heard: '여기 있을', lastHeardAt: 10_000, now: 10_500, ended: false });
  assert.equal(d.advance, false);
});

test('말을 멈추고 조용한 시간이 지나면 넘어간다', () => {
  const d = advanceDecision({
    heard: '여기 있을 줄 알았어',
    lastHeardAt: 10_000,
    now: 10_000 + SILENCE_MS,
    ended: false,
  });
  assert.equal(d.advance, true);
  assert.equal(d.reason, 'silence');
});

test('조용한 시간이 조금 모자라면 아직 기다린다 — 말을 자르지 않는다', () => {
  const d = advanceDecision({
    heard: '여기 있을 줄 알았어',
    lastHeardAt: 10_000,
    now: 10_000 + SILENCE_MS - 1,
    ended: false,
  });
  assert.equal(d.advance, false);
});

test('받아쓰기가 스스로 끝났다고 하면 바로 넘어간다', () => {
  const d = advanceDecision({ heard: '알았어', lastHeardAt: 10_000, now: 10_100, ended: true });
  assert.equal(d.advance, true);
  assert.equal(d.reason, 'ended');
});

test('아무 말도 못 알아들은 채 끝났으면 넘어가지 않는다 — 조용한 방에서 끊긴 경우다', () => {
  const d = advanceDecision({ heard: '   ', lastHeardAt: null, now: 10_100, ended: true });
  assert.equal(d.advance, false);
  assert.equal(d.reason, 'not_started');
});

test('이어서 들리는 말은 길어지는 쪽을 남긴다', () => {
  assert.equal(mergeTranscript('여기 있을', '여기 있을 줄 알았어'), '여기 있을 줄 알았어');
  // 받아쓰기가 중간 결과를 짧게 다시 주는 일이 있다 — 그때 이미 들은 말을 잃지 않는다.
  assert.equal(mergeTranscript('여기 있을 줄 알았어', '여기'), '여기 있을 줄 알았어');
});

test('새 줄로 넘어가면 들은 말은 비운다', () => {
  assert.equal(mergeTranscript('', '어떻게 알았어'), '어떻게 알았어');
  assert.equal(mergeTranscript('앞 줄에서 한 말', ''), '앞 줄에서 한 말');
});

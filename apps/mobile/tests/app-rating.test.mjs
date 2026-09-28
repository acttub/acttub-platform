import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_RATING_STATE, RATING_MAX_ASKS, RATING_MIN_GAP_MS, afterAsk, afterRated, recordEvent } from '../lib/app-rating.ts';

// 앱 평가 요청 (SOMA-494) — AI 코칭 2번마다·대본 1번 완주마다 묻되, 7일 간격·최대 3번,
// "남기기"를 누르면 그만 묻는다. 스토어가 평가 여부를 알려 주지 않으므로 누른 것으로만 판단한다.
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-28T10:00:00+09:00');

test('AI 코칭은 두 번째 연습을 마쳤을 때 처음 묻는다 — 같은 연습을 두 번 세지 않는다', () => {
  let r = recordEvent(EMPTY_RATING_STATE, { kind: 'coach', practiceId: 'p1' }, T0);
  assert.equal(r.ask, false);
  r = recordEvent(r.state, { kind: 'coach', practiceId: 'p1' }, T0);
  assert.equal(r.ask, false);
  r = recordEvent(r.state, { kind: 'coach', practiceId: 'p2' }, T0);
  assert.equal(r.ask, true);
});

test('대본은 한 번 완주하면 바로 묻는다', () => {
  assert.equal(recordEvent(EMPTY_RATING_STATE, { kind: 'reading' }, T0).ask, true);
});

test('물은 뒤에는 코칭 수를 다시 세고, 7일이 지나야 다시 묻는다', () => {
  let s = afterAsk(recordEvent(EMPTY_RATING_STATE, { kind: 'reading' }, T0).state, T0);
  assert.equal(recordEvent(s, { kind: 'reading' }, T0 + 6 * DAY).ask, false);
  let r = recordEvent(s, { kind: 'coach', practiceId: 'a' }, T0 + 8 * DAY);
  assert.equal(r.ask, false);
  r = recordEvent(r.state, { kind: 'coach', practiceId: 'b' }, T0 + 8 * DAY);
  assert.equal(r.ask, true);
  assert.equal(RATING_MIN_GAP_MS, 7 * DAY);
});

test('최대 세 번까지만 묻고, "남기기"를 누르면 다시는 묻지 않는다', () => {
  let s = EMPTY_RATING_STATE;
  let at = T0;
  for (let i = 0; i < RATING_MAX_ASKS; i += 1) {
    const r = recordEvent(s, { kind: 'reading' }, at);
    assert.equal(r.ask, true, `ask #${i + 1}`);
    s = afterAsk(r.state, at);
    at += 8 * DAY;
  }
  assert.equal(recordEvent(s, { kind: 'reading' }, at).ask, false);
  const rated = afterRated(EMPTY_RATING_STATE);
  assert.equal(recordEvent(rated, { kind: 'reading' }, T0).ask, false);
});

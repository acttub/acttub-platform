import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunSummary, median } from '../lib/reading/run-summary.ts';

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

test('reading.run-summary: 회차가 끝나면 숫자만 담은 요약을 한 번만 낸다', () => {
  const s = createRunSummary({ advance: 'silence', handsFree: false });
  s.lineShown();
  s.mineAdvanced('auto');
  const first = s.finish('completed', 'cloud');
  assert.deepEqual(first, {
    advance: 'silence',
    hands_free: false,
    engine: 'cloud',
    mine_auto: 1,
    mine_manual: 0,
    mine_late: 0,
    mine_stable: 0,
    partner_skip: 0,
    partner_full: 0,
    partner_skip_before_audio: 0,
    close_timeouts: 0,
    stt_errors: 0,
    lines: 1,
    ended: 'completed',
  });
  assert.equal(s.finish('left', 'cloud'), null, '같은 회차를 두 번 보내지 않는다');
});

test('reading.run-summary: 상대 줄 — 끝까지 들음·소리 전 건너뜀·소리 뒤 건너뜀·글로 보기를 가른다', () => {
  const s = createRunSummary({ advance: 'silence', handsFree: false });
  // 끝까지 들은 줄: 300ms 뒤 소리
  s.lineShown();
  s.partnerShown(1_000);
  s.partnerAudio(1_300);
  s.partnerAudio(1_900); // 같은 줄의 두 번째 조각은 세지 않는다
  s.partnerHeard();
  s.partnerTapped(); // 다 들은 뒤 누른 [다음]은 건너뛰기가 아니다
  // 소리가 나기 전에 건너뛴 줄
  s.lineShown();
  s.partnerShown(5_000);
  s.partnerTapped();
  s.partnerAudio(9_000); // 건너뛴 뒤 늦게 온 소리는 대기 시간에 넣지 않는다
  // 소리가 난 뒤 건너뛴 줄: 1500ms 대기
  s.lineShown();
  s.partnerShown(10_000);
  s.partnerAudio(11_500);
  s.partnerTapped();
  // 글로만 보인 줄
  s.lineShown();
  s.partnerShown(20_000);
  s.partnerTextOnly();
  s.partnerTapped();
  const p = s.finish('stopped', 'supertonic');
  assert.equal(p.partner_full, 1);
  assert.equal(p.partner_skip, 2);
  assert.equal(p.partner_skip_before_audio, 1);
  assert.equal(p.partner_wait_ms_p50, 300);
  assert.equal(p.partner_wait_ms_max, 1_500);
  assert.equal(p.lines, 4);
  assert.equal(p.ended, 'stopped');
});

test('reading.run-summary: 일시정지 뒤 다시 읽으면 그때부터 잰다', () => {
  const s = createRunSummary({ advance: 'silence', handsFree: false });
  s.lineShown();
  s.partnerShown(0);
  s.partnerShown(10_000);
  s.partnerAudio(10_200);
  assert.equal(s.finish('left', 'cloud').partner_wait_ms_p50, 200);
});

test('reading.run-summary: 내 차례 닫기 — 손으로 넘긴 시간만 재고, 상한에 걸린 대기는 모두 센다', () => {
  const s = createRunSummary({ advance: 'manual', handsFree: false });
  s.mineAdvanced('manual');
  s.turnClosed(400, 0);
  s.mineAdvanced('manual');
  s.turnClosed(3_000, 2);
  s.mineAdvanced('late');
  s.turnClosed(null, 1);
  s.mineAdvanced('manual');
  s.turnClosed(900, 0);
  s.sttError();
  const p = s.finish('completed', 'device_voice');
  assert.equal(p.mine_manual, 3);
  assert.equal(p.mine_late, 1);
  assert.equal(p.close_ms_p50, 900);
  assert.equal(p.close_ms_max, 3_000);
  assert.equal(p.close_timeouts, 3);
  assert.equal(p.stt_errors, 1);
});

test('reading.run-summary: 말 끝 없이 글이 찬 채 넘긴 줄은 mine_stable 로 따로 세고 mine_auto 에 넣지 않는다', () => {
  const s = createRunSummary({ advance: 'silence', handsFree: false });
  s.mineAdvanced('stable');
  s.mineAdvanced('stable');
  s.mineAdvanced('auto');
  s.mineAdvanced('late');
  const p = s.finish('completed', 'cloud');
  assert.equal(p.mine_stable, 2);
  assert.equal(p.mine_auto, 1);
  assert.equal(p.mine_late, 1);
  assert.equal(p.mine_manual, 0);
});

test('reading.run-summary: 잰 값이 없으면 대기·닫기 시간 칸을 빼고 보낸다', () => {
  const p = createRunSummary({ advance: 'timed', handsFree: true }).finish('left', 'text_only');
  assert.equal('partner_wait_ms_p50' in p, false);
  assert.equal('close_ms_max' in p, false);
  assert.equal(p.hands_free, true);
});

test('reading.run-summary: GA4 규칙 — 이름 40자·값 100자·25개 이내', () => {
  const s = createRunSummary({ advance: 'silence', handsFree: false });
  s.partnerShown(0);
  s.partnerAudio(10);
  s.turnClosed(10, 0);
  const p = s.finish('completed', 'x'.repeat(200));
  assert.ok(Object.keys(p).length <= 25);
  for (const [k, v] of Object.entries(p)) {
    assert.match(k, KEY);
    if (typeof v === 'string') assert.ok(v.length <= 100, k);
  }
});

test('reading.run-summary: median 은 가운데(짝수면 아래쪽) 값', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 3, 2]), 2);
});

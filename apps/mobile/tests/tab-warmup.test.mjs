import assert from 'node:assert/strict';
import test from 'node:test';

import { lastRead, readGeneration, rememberReadIfCurrent, resetLastReads } from '../lib/last-reads.ts';
import {
  scheduleTabWarmup,
  WARM_FALLBACK_MS,
  WARM_ORDER,
  WARM_PREFETCH_WAIT_MS,
  WARM_START_DELAY_MS,
} from '../lib/tab-warmup.ts';

/** 가짜 시계 — wait 로 건 일을 now 순서대로 돌린다. */
function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    wait(ms, task) {
      const timer = { at: now + ms, task, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers = timers.filter((t) => t.live);
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.task();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

function harness({ prefetch = () => Promise.resolve() } = {}) {
  const clock = fakeClock();
  const warmed = [];
  let homeListener = null;
  const stop = scheduleTabWarmup({
    onHomeReady: (listener) => {
      homeListener = listener;
      return () => {
        homeListener = null;
      };
    },
    afterInteractions: (task) => ({ cancel: clock.wait(0, task) }),
    wait: clock.wait,
    prefetchCommunity: prefetch,
    warm: (tab) => warmed.push(tab),
  });
  return { clock, warmed, stop, homeReady: () => homeListener?.() };
}

test('홈이 뜬 뒤에만, 정해진 순서로 하나씩 만든다', async () => {
  const h = harness();
  await h.clock.advance(WARM_START_DELAY_MS * 2);
  assert.deepEqual(h.warmed, [], '홈이 뜨기 전에는 만들지 않는다');
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS - 1);
  assert.deepEqual(h.warmed, [], '홈이 뜬 직후에는 잠깐 기다린다');
  await h.clock.advance(1);
  assert.deepEqual(h.warmed, ['coaching']);
  await h.clock.advance(5000);
  assert.deepEqual(h.warmed, [...WARM_ORDER]);
});

test('커뮤니티는 목록을 받아 둔 뒤에 만들고, 받기가 늦으면 상한 뒤에 만든다', async () => {
  let resolve;
  const h = harness({ prefetch: () => new Promise((r) => (resolve = r)) });
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS + 2000);
  assert.deepEqual(h.warmed, ['coaching', 'reading'], '받는 중에는 커뮤니티를 만들지 않는다');
  await h.clock.advance(WARM_PREFETCH_WAIT_MS);
  assert.ok(h.warmed.includes('challenges'), '상한이 지나면 만든다');
  resolve();
  await h.clock.advance(5000);
  assert.equal(h.warmed.filter((t) => t === 'challenges').length, 1, '두 번 만들지 않는다');
  assert.deepEqual(h.warmed, [...WARM_ORDER]);
});

test('받기가 실패해도 커뮤니티를 만든다', async () => {
  const h = harness({ prefetch: () => Promise.reject(new Error('offline')) });
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS + 3000);
  assert.deepEqual(h.warmed, [...WARM_ORDER]);
});

test('홈을 거치지 않고 들어와도 상한 뒤에는 만든다', async () => {
  const h = harness();
  await h.clock.advance(WARM_FALLBACK_MS + WARM_START_DELAY_MS);
  assert.deepEqual(h.warmed, ['coaching']);
  h.homeReady();
  await h.clock.advance(5000);
  assert.deepEqual(h.warmed, [...WARM_ORDER], '홈이 늦게 떠도 처음부터 다시 하지 않는다');
});

test('멈추면 남은 탭은 만들지 않는다', async () => {
  const h = harness();
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS);
  h.stop();
  await h.clock.advance(10_000);
  assert.deepEqual(h.warmed, ['coaching']);
});

test('마지막 답: 로그아웃 뒤에 늦게 온 옛 계정 답은 남기지 않는다', () => {
  resetLastReads();
  const asked = readGeneration();
  rememberReadIfCurrent('practiceGroups', { groups: [1] }, asked);
  assert.deepEqual(lastRead('practiceGroups'), { groups: [1] });
  const askedBefore = readGeneration();
  resetLastReads();
  assert.equal(lastRead('practiceGroups'), undefined, '로그아웃하면 비운다');
  rememberReadIfCurrent('practiceGroups', { groups: [2] }, askedBefore);
  assert.equal(lastRead('practiceGroups'), undefined, '옛 계정 답');
  rememberReadIfCurrent('practiceGroups', { groups: [3] }, readGeneration());
  assert.deepEqual(lastRead('practiceGroups'), { groups: [3] });
  resetLastReads();
});

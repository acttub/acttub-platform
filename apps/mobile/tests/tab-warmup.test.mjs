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

function harness({ prefetch = () => Promise.resolve(), others, homeShowing = () => false } = {}) {
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
    prefetchOthers: others,
    homeShowing,
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

test('홈이 첫 데이터를 받는 중이면 상한이 지나도 만들지 않고, 홈이 뜨면 그때 만든다', async () => {
  // 다른 탭을 만들면 그 탭들도 서버를 불러 홈이 받는 답과 다툰다 — 홈이 느릴수록 더 늦어졌다(11/3).
  const h = harness({ homeShowing: () => true });
  await h.clock.advance(WARM_FALLBACK_MS * 3);
  assert.deepEqual(h.warmed, []);
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS);
  assert.deepEqual(h.warmed, ['coaching']);
});

test('홈에서 기다리다 다른 화면으로 가면 다음 확인 때 만든다', async () => {
  let showing = true;
  const h = harness({ homeShowing: () => showing });
  await h.clock.advance(WARM_FALLBACK_MS);
  assert.deepEqual(h.warmed, []);
  showing = false;
  await h.clock.advance(WARM_FALLBACK_MS + WARM_START_DELAY_MS);
  assert.deepEqual(h.warmed, ['coaching']);
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

test('받기는 홈이 뜨는 즉시 시작한다 — 첫 탭을 만들기 시작하는 시간을 기다리지 않는다', async () => {
  const calls = [];
  const h = harness({
    prefetch: () => (calls.push('community'), Promise.resolve()),
    others: () => (calls.push('others'), Promise.resolve()),
  });
  await h.clock.advance(1000);
  assert.deepEqual(calls, [], '홈이 뜨기 전에는 받지 않는다');
  h.homeReady();
  assert.deepEqual(calls, ['community', 'others'], '홈이 뜬 바로 그 순간 함께 시작');
  assert.deepEqual(h.warmed, [], '탭은 아직 만들지 않았다');
  await h.clock.advance(WARM_START_DELAY_MS + 5000);
  assert.deepEqual(calls, ['community', 'others'], '커뮤니티를 만들 때 목록을 다시 받지 않는다');
  assert.deepEqual(h.warmed, [...WARM_ORDER]);
});

test('나머지 탭 받기가 실패하거나 끝나지 않아도 탭 만들기는 막지 않는다', async () => {
  const h = harness({ others: () => Promise.reject(new Error('offline')) });
  h.homeReady();
  await h.clock.advance(WARM_START_DELAY_MS + 3000);
  assert.deepEqual(h.warmed, [...WARM_ORDER]);
  const h2 = harness({ others: () => new Promise(() => undefined) });
  h2.homeReady();
  await h2.clock.advance(WARM_START_DELAY_MS + 3000);
  assert.deepEqual(h2.warmed, [...WARM_ORDER]);
});

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { lastRead, rememberRead, resetLastReads } from '../lib/last-reads.ts';
import { prefetchCommunity, prefetchOtherTabs, prefetchProfileCounts, prefetchReadingResume } from '../lib/tab-prefetch.ts';

const NOW = new Date('2026-11-03T12:00:00+09:00');
const script = (id, status, last = null) => ({ id, status, last_practiced_at: last });

function fakeApi({ scripts = [], sessions = {}, groups = [], entries = [], pages = null, fail = {} } = {}) {
  const calls = [];
  const note = (name, ...args) => {
    calls.push([name, ...args].join(':'));
    if (fail[name]) return Promise.reject(new Error(name));
    return null;
  };
  return {
    calls,
    listChallenges: (p) => note('challenges', p.tab) ?? Promise.resolve({}),
    listPracticeGroups: () => note('groups') ?? Promise.resolve({ groups }),
    listReadingScripts: () => note('scripts') ?? Promise.resolve({ scripts }),
    listReadingSessions: (id) => note('sessions', id) ?? Promise.resolve({ sessions: sessions[id] ?? [] }),
    listMyChallengeEntries: (_k, cursor) => note('entries', cursor ?? '') ?? Promise.resolve(pages ? pages[cursor ?? ''] : { entries, next_cursor: null }),
  };
}

beforeEach(() => resetLastReads());

test('커뮤니티: 인기·끝난 목록을 같이 받고 하나가 실패해도 끝난다', async () => {
  const api = fakeApi({ fail: { challenges: true } });
  await prefetchCommunity(api);
  assert.deepEqual(api.calls, ['challenges:popular', 'challenges:ended']);
});

test('리딩: 홈이 받아 둔 대본 목록으로 이어 읽을 회차 하나만 받아 카드를 남긴다', async () => {
  const s = script('a', 'reading');
  rememberRead('readingScripts', { scripts: [s] });
  const session = { id: 's1', status: 'in_progress', progress: { index: 3 } };
  const api = fakeApi({ sessions: { a: [session] } });
  await prefetchReadingResume(api);
  assert.deepEqual(api.calls, ['sessions:a'], '대본 목록은 다시 받지 않는다');
  assert.deepEqual(lastRead('readingResume'), { script: s, session });
});

test('리딩: 이어 읽을 대본이 없으면 카드 없음으로 남기고 회차를 받지 않는다', async () => {
  rememberRead('readingScripts', { scripts: [script('a', 'ready')] });
  const api = fakeApi();
  await prefetchReadingResume(api);
  assert.deepEqual(api.calls, []);
  assert.equal(lastRead('readingResume'), null);
});

test('리딩: 홈 목록이 없으면 목록부터 받는다', async () => {
  const api = fakeApi({ scripts: [script('a', 'ready')] });
  await prefetchReadingResume(api);
  assert.deepEqual(api.calls, ['scripts']);
});

test('프로필: 홈이 받은 묶음·참여작 첫 장을 쓰고, 다음 장과 이번 달 대본 회차만 더 받아 숫자를 남긴다', async () => {
  rememberRead('practiceGroups', { groups: [] });
  rememberRead('readingScripts', { scripts: [script('a', 'reading', '2026-11-02T00:00:00+09:00'), script('b', 'reading', '2026-09-01T00:00:00+09:00')] });
  rememberRead('myChallengeEntries', { entries: [], next_cursor: 'c2' });
  const api = fakeApi({ pages: { c2: { entries: [], next_cursor: null } }, sessions: { a: [] } });
  await prefetchProfileCounts(api, NOW);
  assert.deepEqual(api.calls.sort(), ['entries:c2', 'sessions:a']);
  assert.deepEqual(lastRead('profileMonthCounts'), { coaching: 0, reading: 0, challenge: 0, total: 0 });
});

test('프로필: 하나라도 받기에 실패하면 틀린 숫자를 남기지 않는다', async () => {
  rememberRead('practiceGroups', { groups: [] });
  rememberRead('readingScripts', { scripts: [script('a', 'reading', '2026-11-02T00:00:00+09:00')] });
  rememberRead('myChallengeEntries', { entries: [], next_cursor: null });
  const api = fakeApi({ fail: { sessions: true } });
  await assert.rejects(prefetchProfileCounts(api, NOW));
  assert.equal(lastRead('profileMonthCounts'), undefined);
});

test('나머지 탭: 하나가 실패해도 다른 하나는 남고, 전부 끝나면 풀린다', async () => {
  rememberRead('practiceGroups', { groups: [] });
  rememberRead('myChallengeEntries', { entries: [], next_cursor: null });
  rememberRead('readingScripts', { scripts: [script('a', 'reading')] });
  const api = fakeApi({ fail: { sessions: true } });
  const results = await prefetchOtherTabs(api, NOW);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.deepEqual(lastRead('profileMonthCounts'), { coaching: 0, reading: 0, challenge: 0, total: 0 });
});

test('로그아웃 뒤에 늦게 온 옛 계정 답은 남기지 않는다', async () => {
  rememberRead('readingScripts', { scripts: [script('a', 'reading')] });
  let release;
  const api = fakeApi();
  api.listReadingSessions = () => new Promise((r) => (release = r));
  const pending = prefetchReadingResume(api);
  await new Promise((r) => setImmediate(r));
  resetLastReads();
  release({ sessions: [{ id: 's', status: 'in_progress', progress: {} }] });
  await pending;
  assert.equal(lastRead('readingResume'), undefined);
});

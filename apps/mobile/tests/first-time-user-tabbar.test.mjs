import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  firstTimeStateFrom,
  getFirstTimeState,
  setFirstTimeState,
  shouldRememberGraduation,
  subscribeFirstTimeState,
} from '../lib/practice/first-time.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const base = { loaded: true, groupsFailed: false, groups: [], scripts: [], practicedDays: 0 };

test('홈 「뭐부터 해 볼까요?」와 같은 기준 — 끝낸 연습이 하나도 없어야 첫 사용자다', () => {
  assert.equal(firstTimeStateFrom(base), 'first');
});

test('연습 1회를 끝내야 첫 사용자가 아니다 — 시작만 하고 나간 사람은 계속 첫 사용자(SOMA-827)', () => {
  assert.equal(firstTimeStateFrom({ ...base, practicedDays: 1 }), 'practiced');
  // 노트 전에 나간 코칭 묶음, 넣기만 한 대본은 아직 첫 사용자다.
  assert.equal(firstTimeStateFrom({ ...base, groups: [{ root_id: 'r1', practices: [{ note: null }] }] }), 'first');
  assert.equal(firstTimeStateFrom({ ...base, scripts: [{ id: 's1', status: 'reading' }] }), 'first');
  // 노트가 생긴 코칭·끝까지 읽은 대본은 끝낸 연습이다.
  assert.equal(firstTimeStateFrom({ ...base, groups: [{ root_id: 'r1', practices: [{ note: { id: 'n' } }] }] }), 'practiced');
  assert.equal(firstTimeStateFrom({ ...base, scripts: [{ id: 's1', status: 'completed' }] }), 'practiced');
  // 묶음을 못 받아도 끝낸 대본·연습한 날이 보이면 첫 사용자가 아니다.
  assert.equal(firstTimeStateFrom({ ...base, groupsFailed: true, scripts: [{ id: 's1', status: 'completed' }] }), 'practiced');
});

test('기록을 아직 다 못 받았거나 묶음을 못 받았으면 모른다 — 함부로 첫 사용자로 보지 않는다', () => {
  assert.equal(firstTimeStateFrom({ ...base, loaded: false }), 'unknown');
  assert.equal(firstTimeStateFrom({ ...base, groupsFailed: true }), 'unknown');
});

test('첫 사용자 상태는 한 곳에 두고 바뀌면 구독자에게 알린다', () => {
  assert.equal(getFirstTimeState(), 'unknown');
  let calls = 0;
  const off = subscribeFirstTimeState(() => {
    calls += 1;
  });
  setFirstTimeState('first');
  setFirstTimeState('first');
  assert.equal(getFirstTimeState(), 'first');
  assert.equal(calls, 1);
  setFirstTimeState('practiced');
  assert.equal(calls, 2);
  off();
  setFirstTimeState('unknown');
  assert.equal(calls, 2);
});

test('홈은 첫 사용자 화면과 탭바 숨김을 같은 판단 하나로 정하고, 홈을 떠나도 지우지 않는다', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /const firstTime = firstTimeStateFrom\(/);
  assert.match(home, /const firstUser = firstTime === 'first'/);
  assert.match(home, /setFirstTimeState\(firstTime\)/);
  assert.doesNotMatch(home, /setHomeTabBarHidden/);
});

test('첫 사용자 판단은 홈의 isFirstUser 를 그대로 쓴다', () => {
  assert.match(read('lib/practice/first-time.ts'), /isFirstUser\(/);
});

test('탭 레이아웃은 첫 사용자면 모든 탭에서 탭바를 숨긴다', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  // 홈이 첫 사용자 뼈대를 그리는 동안에도 숨긴다(lib/skeleton-hint) — 판단은 lib/practice/first-time 한 곳.
  assert.match(layout, /const tabBarHidden = useFirstTimeTabBarHidden\(\);/);
  assert.match(layout, /tabBarStyle: tabBarHidden \? TAB_BAR_HIDDEN : tabBarStyle/);
});

test('탭바가 숨는 동안 코칭·대본 첫 화면에서 설정으로 갈 수 있다 — 로그아웃·탈퇴가 막히면 안 된다', () => {
  const coaching = read('app/(tabs)/coaching.tsx');
  assert.match(coaching, /phLabel="coaching_first_settings"/);
  assert.match(coaching, /router\.push\('\/settings'\)/);
  const reading = read('app/(tabs)/reading.tsx');
  assert.match(reading, /phLabel="reading_first_settings"/);
  assert.match(reading, /router\.push\('\/settings'\)/);
});

test('대본 목록·리딩 회차·참여작을 못 받았으면 첫 사용자로 보지 않는다(11/2)', () => {
  assert.equal(firstTimeStateFrom({ ...base, recordsFailed: true }), 'unknown');
  // 받은 것만으로도 끝낸 연습이 보이면 그대로 기존 사용자다.
  assert.equal(firstTimeStateFrom({ ...base, recordsFailed: true, practicedDays: 2 }), 'practiced');
});

test('기록으로 첫 사용자를 벗어나면 졸업 표시를 남긴다 — 다시 읽기 시작해도 첫 홈으로 돌아가지 않게(11/2)', () => {
  assert.equal(shouldRememberGraduation('practiced', false), true);
  // 이미 남겼거나 아직 표시를 못 읽었으면(null) 남기지 않는다.
  assert.equal(shouldRememberGraduation('practiced', true), false);
  assert.equal(shouldRememberGraduation('practiced', null), false);
  assert.equal(shouldRememberGraduation('first', false), false);
  assert.equal(shouldRememberGraduation('unknown', false), false);
  // 졸업 표시가 있으면 서버 기록이 「연습 중」 대본뿐이어도 기존 사용자다.
  assert.equal(firstTimeStateFrom({ ...base, scripts: [{ id: 's1', status: 'reading' }], graduated: true }), 'practiced');
});

test('홈은 첫 사용자 판정을 기기에 남기고, 오래전에 읽은 대본과 못 받은 목록도 따진다(11/2)', () => {
  const src = read('app/(tabs)/index.tsx');
  assert.match(src, /shouldRememberGraduation\(firstTime, graduated\)/);
  assert.match(src, /olderPracticedScripts\(scriptList\)/);
  assert.match(src, /setRecordsFailed\(readFailed\)/);
  assert.match(src, /recordsFailed,\n\s+groups,/);
});

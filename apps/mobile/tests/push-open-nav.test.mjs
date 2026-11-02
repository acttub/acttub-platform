import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openPushTarget } from '../lib/push-open-nav.ts';

function fakeRouter(canDismiss) {
  const calls = [];
  return {
    calls,
    replace: (h) => calls.push(['replace', h]),
    push: (h) => calls.push(['push', h]),
    dismissAll: () => calls.push(['dismissAll']),
    canDismiss: () => canDismiss,
  };
}

test('알림 화면은 홈 위에 올린다 — 뒤로가기가 앱을 닫지 않는다(11/2 폰 QA)', () => {
  const r = fakeRouter(false);
  openPushTarget(r, '/reminder-open?kind=script_ready&id=x');
  assert.deepEqual(r.calls, [['replace', '/(tabs)'], ['push', '/reminder-open?kind=script_ready&id=x']]);
});

test('쌓인 화면이 있으면 먼저 걷는다', () => {
  const r = fakeRouter(true);
  openPushTarget(r, '/coach?practiceId=p');
  assert.deepEqual(r.calls, [['dismissAll'], ['replace', '/(tabs)'], ['push', '/coach?practiceId=p']]);
});

test('대상이 탭이면 그 탭으로만 간다', () => {
  for (const tab of ['/(tabs)', '/reading']) {
    const r = fakeRouter(false);
    openPushTarget(r, tab);
    assert.deepEqual(r.calls, [['replace', tab]]);
  }
});

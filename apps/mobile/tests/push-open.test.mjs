import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushOpenRecorder, pushOpenRecord } from '../lib/push-open.ts';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

function recorder({ failures = 0 } = {}) {
  const sent = [];
  let left = failures;
  const r = createPushOpenRecorder({
    send: async (body) => {
      sent.push(body);
      if (left > 0) {
        left -= 1;
        throw new TypeError('offline');
      }
    },
    platform: () => 'ios',
  });
  return { r, sent };
}

test('account.notification: 연습 알림 data 에서 kind·reminder_kind·template_id 만 뽑는다', () => {
  assert.deepEqual(
    pushOpenRecord({ kind: 'evening_reminder', reminder_kind: 'streak', template_id: 'streak.1.a', practice_id: 'p' }),
    { kind: 'evening_reminder', reminder_kind: 'streak', template_id: 'streak.1.a' },
  );
  assert.deepEqual(pushOpenRecord({ kind: 'analysis_complete', practice_id: 'p' }), { kind: 'analysis_complete' });
  assert.deepEqual(pushOpenRecord({ type: 'challenge_notification', kind: 'entry_liked' }), { kind: 'entry_liked' });
});

test('account.notification: kind 가 없거나 문자열이 아니면 unknown, 객체가 아니면 남기지 않는다', () => {
  assert.deepEqual(pushOpenRecord({}), { kind: 'unknown' });
  assert.deepEqual(pushOpenRecord({ kind: 3 }), { kind: 'unknown' });
  assert.deepEqual(pushOpenRecord({ kind: '  ' }), { kind: 'unknown' });
  for (const bad of [null, undefined, 'x', 7, ['a']]) assert.equal(pushOpenRecord(bad), null);
});

test('account.notification: 서버 한도(40·40·60)로 자른다', () => {
  const r = pushOpenRecord({ kind: 'k'.repeat(50), reminder_kind: 'r'.repeat(50), template_id: 't'.repeat(80) });
  assert.equal(r.kind.length, 40);
  assert.equal(r.reminder_kind.length, 40);
  assert.equal(r.template_id.length, 60);
});

test('로그인한 회원이 있으면 바로 보내고 플랫폼을 싣는다', async () => {
  const { r, sent } = recorder();
  r.setSignedIn(true);
  r.capture('n1', { kind: 'evening_reminder', reminder_kind: 'general', template_id: 'g.1' });
  await flushMicrotasks();
  assert.deepEqual(sent, [{ kind: 'evening_reminder', reminder_kind: 'general', template_id: 'g.1', platform: 'ios' }]);
});

test('같은 알림 식별자는 한 번만 센다(콜드 스타트 조회 + 리스너)', async () => {
  const { r, sent } = recorder();
  r.setSignedIn(true);
  r.capture('n1', { kind: 'analysis_complete' });
  r.capture('n1', { kind: 'analysis_complete' });
  r.capture('n2', { kind: 'analysis_complete' });
  await flushMicrotasks();
  assert.equal(sent.length, 2);
});

test('로그인 전에 눌린 탭은 들고 있다가 로그인한 회원이 생기면 보낸다', async () => {
  const { r, sent } = recorder();
  r.capture('n1', { kind: 'entry_liked' });
  await flushMicrotasks();
  assert.equal(sent.length, 0);

  r.setSignedIn(true);
  await flushMicrotasks();
  assert.deepEqual(sent.map((b) => b.kind), ['entry_liked']);

  r.setSignedIn(false);
  r.setSignedIn(true);
  await flushMicrotasks();
  assert.equal(sent.length, 1, '보낸 것은 다시 보내지 않는다');
});

test('보내기가 한 번 실패하면 한 번만 다시 보내고 두 번 실패하면 버린다. 예외는 밖으로 안 나온다', async () => {
  const once = recorder({ failures: 1 });
  once.r.setSignedIn(true);
  once.r.capture('n1', { kind: 'x' });
  await flushMicrotasks();
  assert.equal(once.sent.length, 2);

  const twice = recorder({ failures: 5 });
  twice.r.setSignedIn(true);
  twice.r.capture('n1', { kind: 'x' });
  await flushMicrotasks();
  assert.equal(twice.sent.length, 2);
});

test('data 가 객체가 아닌 탭은 보내지 않는다', async () => {
  const { r, sent } = recorder();
  r.setSignedIn(true);
  r.capture('n1', null);
  await flushMicrotasks();
  assert.equal(sent.length, 0);
});

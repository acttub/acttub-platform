import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostHogBridge, decidePostHog } from '../lib/posthog.ts';

// SDK 대신 쓰는 가짜. 보낸 이벤트와 식별·녹화 상태만 흉내 낸다 — reset 은 새 익명 ID 를 주고
// 저장된 opt-in 을 지워 defaultOptIn(false)으로 돌아간다.
class FakePostHog {
  constructor(key) {
    this.key = key;
    this.optedOut = true;
    this.recording = true;
    this.anonymous = 1;
    this.distinctId = 'anon-1';
    this.sent = [];
  }
  capture(event, properties) {
    if (!this.optedOut) this.sent.push({ event, distinctId: this.distinctId, properties });
  }
  async screen(name) {
    if (!this.optedOut) this.sent.push({ event: '$screen', distinctId: this.distinctId, properties: { $screen_name: name } });
  }
  identify(id) {
    this.distinctId = id;
  }
  reset() {
    this.anonymous += 1;
    this.distinctId = `anon-${this.anonymous}`;
    this.optedOut = true;
  }
  async optIn() {
    this.optedOut = false;
  }
  async optOut() {
    this.optedOut = true;
  }
  async startSessionRecording() {
    this.recording = true;
  }
  async stopSessionRecording() {
    this.recording = false;
  }
}

function fakeSdk() {
  const clients = [];
  const bridge = createPostHogBridge((key) => {
    const client = new FakePostHog(key);
    clients.push(client);
    return client;
  });
  return { bridge, clients };
}

const ON = { on: true, key: 'phc_test' };
const OFF = { on: false };

test('decidePostHog: 운영 API·키·현재 판 동의가 모두 있을 때만 켠다', () => {
  const cases = [
    [{ productionApi: true, key: 'phc_test', consent: 'allowed' }, { on: true, key: 'phc_test' }],
    [{ productionApi: true, key: ' phc_test\n', consent: 'allowed' }, { on: true, key: 'phc_test' }],
    [{ productionApi: true, key: undefined, consent: 'allowed' }, { on: false }],
    [{ productionApi: true, key: '', consent: 'allowed' }, { on: false }],
    [{ productionApi: true, key: '   ', consent: 'allowed' }, { on: false }],
    [{ productionApi: false, key: 'phc_test', consent: 'allowed' }, { on: false }],
    [{ productionApi: true, key: 'phc_test', consent: 'checking' }, { on: false }],
    [{ productionApi: true, key: 'phc_test', consent: 'error' }, { on: false }],
    [{ productionApi: true, key: 'phc_test', consent: 'decision_required' }, { on: false }],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(decidePostHog(input), expected, JSON.stringify(input));
  }
});

test('PostHog: 켜기 전에는 클라이언트를 만들지 않는다 — 리플레이 네이티브 모듈이 만들자마자 녹화한다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.sync(OFF);
  bridge.capture('before_consent');
  bridge.screen('/login');
  assert.equal(clients.length, 0);

  bridge.sync(ON);
  bridge.capture('practice_start', { kind: 'monologue' });
  assert.equal(clients.length, 1);
  assert.equal(clients[0].key, 'phc_test');
  assert.deepEqual(clients[0].sent, [
    { event: 'practice_start', distinctId: 'anon-1', properties: { kind: 'monologue' } },
  ]);
});

test('PostHog: 끄면 이벤트와 녹화가 멈추고, 다시 켜면 같은 클라이언트로 이어 간다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.sync(ON);
  bridge.sync(OFF);
  bridge.capture('while_off');
  bridge.screen('/(tabs)');
  assert.equal(clients[0].recording, false);
  assert.deepEqual(clients[0].sent, []);

  bridge.sync(ON);
  bridge.screen('/(tabs)');
  assert.equal(clients.length, 1);
  assert.equal(clients[0].recording, true);
  assert.deepEqual(clients[0].sent, [
    { event: '$screen', distinctId: 'anon-1', properties: { $screen_name: '/(tabs)' } },
  ]);
});

test('PostHog: 켜기 전에 받은 회원 번호로 만들자마자 식별한다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.setUser('member-42');
  bridge.sync(ON);
  bridge.capture('home_view');
  assert.deepEqual(clients[0].sent, [{ event: 'home_view', distinctId: 'member-42', properties: undefined }]);
});

test('PostHog: 회원 번호를 지우면 reset 해 다음 기록이 앞 계정에 붙지 않는다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.sync(ON);
  bridge.setUser('member-42');
  bridge.capture('a');
  bridge.setUser(null);
  bridge.capture('b');
  assert.deepEqual(clients[0].sent, [
    { event: 'a', distinctId: 'member-42', properties: undefined },
    { event: 'b', distinctId: 'anon-2', properties: undefined },
  ]);
});

test('PostHog: 게스트는 프로필을 읽을 때마다 null 이 와도 익명 ID 를 갈지 않는다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.sync(ON);
  bridge.setUser(null);
  bridge.setUser(null);
  bridge.capture('guest_event');
  assert.deepEqual(clients[0].sent, [{ event: 'guest_event', distinctId: 'anon-1', properties: undefined }]);
});

test('PostHog: 꺼진 동안의 로그아웃도 reset 하고, 다시 켤 때 다음 사람을 익명으로 시작한다', () => {
  const { bridge, clients } = fakeSdk();
  bridge.sync(ON);
  bridge.setUser('member-42');
  bridge.sync(OFF);
  bridge.setUser(null);
  bridge.sync(ON);
  bridge.capture('next_person');
  assert.deepEqual(clients[0].sent, [{ event: 'next_person', distinctId: 'anon-2', properties: undefined }]);
});

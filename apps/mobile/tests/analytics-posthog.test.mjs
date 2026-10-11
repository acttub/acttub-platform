import assert from 'node:assert/strict';
import test from 'node:test';

// 운영 빌드처럼 env 를 두고, 앱이 함수 안에서 부르는 require 를 가짜 SDK 로 받는다.
// Firebase 모듈은 없는 것으로 둔다 — Firebase 쪽은 analytics-user-id 테스트가 본다.
process.env.EXPO_PUBLIC_API_URL = 'https://acttub.com';
process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';

const clients = [];
globalThis.require = (name) => {
  if (name !== 'posthog-react-native') throw new Error(`Cannot find module '${name}'`);
  return {
    PostHog: class {
      constructor(key) {
        this.key = key;
        this.distinctId = 'anon-1';
        this.optedOut = true;
        this.sent = [];
        clients.push(this);
      }
      capture(event) {
        if (!this.optedOut) this.sent.push(`${this.distinctId} ${event}`);
      }
      async screen(name) {
        if (!this.optedOut) this.sent.push(`${this.distinctId} $screen ${name}`);
      }
      identify(id) {
        this.distinctId = id;
      }
      reset() {
        this.distinctId = 'anon-2';
        this.optedOut = true;
      }
      async optIn() {
        this.optedOut = false;
      }
      async optOut() {
        this.optedOut = true;
      }
      async startSessionRecording() {}
      async stopSessionRecording() {}
    },
  };
};

const { logEvent, logScreenView, setAnalyticsUserId } = await import('../lib/analytics.ts');
const { syncPostHog } = await import('../lib/posthog.ts');

test('analytics: 동의 뒤에는 이벤트·화면을 PostHog 로도 보내고, 회원 번호를 지우면 reset 한다', async () => {
  await logEvent('before_consent');
  syncPostHog('decision_required');
  await logScreenView('/consent');
  assert.equal(clients.length, 0);

  syncPostHog('allowed');
  await setAnalyticsUserId('member-42');
  await logScreenView('/(tabs)');
  await logEvent('practice_start', { kind: 'monologue' });
  await setAnalyticsUserId(null);
  await logEvent('after_sign_out');

  assert.equal(clients.length, 1);
  assert.equal(clients[0].key, 'phc_test');
  assert.deepEqual(clients[0].sent, [
    'member-42 $screen /(tabs)',
    'member-42 practice_start',
    'anon-2 after_sign_out',
  ]);
});

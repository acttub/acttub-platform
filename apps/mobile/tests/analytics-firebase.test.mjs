import assert from 'node:assert/strict';
import test from 'node:test';

// 운영 API 빌드처럼 env 를 두고 Firebase Analytics 네이티브 모듈만 가짜로 준다. PostHog 는 키가 없어 꺼진 채로 둔다.
// 모듈이 Firebase 인스턴스를 한 번만 만들므로 경우마다 새 인스턴스를 불러온다.
process.env.EXPO_PUBLIC_API_URL = 'https://acttub.com';
delete process.env.EXPO_PUBLIC_POSTHOG_KEY;

const firebase = {};
function resetFirebase(shape = 'modular', { fails = false, factoryReturns } = {}) {
  Object.assign(firebase, { shape, fails, factoryReturns, sent: [], users: [] });
}
globalThis.require = (name) => {
  if (name !== '@react-native-firebase/analytics' || firebase.shape === 'missing') throw new Error(`Cannot find module '${name}'`);
  const factory = () => (firebase.factoryReturns === undefined ? { app: firebase.shape } : firebase.factoryReturns);
  const api = {
    logEvent: async (instance, event, params) => {
      if (firebase.fails) throw new Error('firebase not initialized');
      firebase.sent.push([instance.app, event, params]);
    },
    setUserId: async (instance, id) => {
      if (firebase.fails) throw new Error('firebase not initialized');
      firebase.users.push([instance.app, id]);
    },
  };
  return firebase.shape === 'modular' ? { ...api, getAnalytics: factory } : { ...api, default: factory };
};

let instance = 0;
const load = () => import(`../lib/analytics.ts?firebase=${++instance}`);

test('analytics: 운영 빌드는 이벤트·화면 조회·회원 번호를 Firebase 로 보낸다', async () => {
  resetFirebase('modular');
  const analytics = await load();
  await analytics.logEvent('practice_start', { kind: 'monologue' });
  await analytics.logScreenView('/(tabs)');
  await analytics.setAnalyticsUserId('member-42');
  await analytics.setAnalyticsUserId(null);
  assert.deepEqual(firebase.sent, [
    ['modular', 'practice_start', { kind: 'monologue' }],
    ['modular', 'screen_view', { screen_name: '/(tabs)', screen_class: '/(tabs)' }],
  ]);
  assert.deepEqual(firebase.users, [['modular', 'member-42'], ['modular', null]]);
});

test('analytics: getAnalytics 가 없는 옛 모듈은 default 로 인스턴스를 만든다', async () => {
  resetFirebase('namespaced');
  const analytics = await load();
  await analytics.logEvent('signup_complete');
  assert.deepEqual(firebase.sent, [['namespaced', 'signup_complete', undefined]]);
});

test('analytics: Firebase 가 던져도 이벤트·회원 번호 호출은 조용히 끝난다', async () => {
  resetFirebase('modular', { fails: true });
  const analytics = await load();
  await assert.doesNotReject(() => analytics.logEvent('practice_start'));
  await assert.doesNotReject(() => analytics.setAnalyticsUserId('member-42'));
  assert.deepEqual(firebase.sent, []);
  assert.deepEqual(firebase.users, []);
});

test('analytics: 모듈이 없거나 인스턴스를 못 만들면 아무것도 보내지 않는다', async () => {
  resetFirebase('missing');
  const missing = await load();
  await missing.logEvent('practice_start');
  firebase.shape = 'modular';
  await missing.setAnalyticsUserId('member-42');
  assert.deepEqual(firebase.sent, []);
  assert.deepEqual(firebase.users, []);

  resetFirebase('modular', { factoryReturns: null });
  const empty = await load();
  await empty.logEvent('practice_start');
  await empty.setAnalyticsUserId('member-42');
  assert.deepEqual(firebase.sent, []);
  assert.deepEqual(firebase.users, []);
});

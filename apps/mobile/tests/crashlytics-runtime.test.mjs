import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// 운영 API 빌드처럼 env 를 두고, 함수 안 require 로 닿는 Crashlytics 네이티브 모듈만 가짜로 준다.
process.env.EXPO_PUBLIC_API_URL = 'https://acttub.com';

const crash = { installed: true, attributes: {}, logs: [], errors: [] };
const instance = { name: 'crashlytics' };
globalThis.require = (name) => {
  if (name !== '@react-native-firebase/crashlytics' || !crash.installed) throw new Error(`Cannot find module '${name}'`);
  return {
    getCrashlytics: () => instance,
    setAttribute: async (target, key, value) => {
      assert.equal(target, instance);
      crash.attributes[key] = value;
    },
    recordError: (target, error) => {
      assert.equal(target, instance);
      crash.errors.push(error);
    },
    log: (target, message) => {
      assert.equal(target, instance);
      crash.logs.push(message);
    },
  };
};

const { initCrashlytics, markEntryPath, markScreen, recordHandledError } = await import('../lib/crashlytics.ts');

beforeEach(() => {
  Object.assign(crash, { installed: true, attributes: {}, logs: [], errors: [] });
});

test('crashlytics: 운영 API 빌드는 크래시에 api_env=prod 를 붙인다', async () => {
  await initCrashlytics();
  assert.deepEqual(crash.attributes, { api_env: 'prod' });
});

test('crashlytics: 화면이 처리한 오류는 원인 그대로, 오류가 아닌 값은 글자로 감싸 남긴다', () => {
  const cause = new TypeError('fetch failed');
  recordHandledError(cause);
  recordHandledError('quota');
  assert.equal(crash.errors[0], cause);
  assert.ok(crash.errors[1] instanceof Error);
  assert.equal(crash.errors[1].message, 'quota');
});

test('crashlytics: 화면이 바뀌면 마지막 화면(속성)과 지나온 화면(로그)을 남긴다', () => {
  markScreen('/(tabs)/library');
  markScreen('/practice/analyze');
  assert.equal(crash.attributes.screen, '/practice/analyze');
  assert.deepEqual(crash.logs, ['screen /(tabs)/library', 'screen /practice/analyze']);
});

test('crashlytics: 바깥에서 들어온 주소는 질의·조각을 떼고 남긴다 — 로그인 code 같은 값이 기록에 남지 않게', () => {
  markEntryPath('actingapp://entry/12?code=secret&state=s#frag', true);
  markEntryPath('/consent', false);
  assert.equal(crash.attributes.entry_path, '/consent');
  assert.deepEqual(crash.logs, ['entry cold actingapp://entry/12', 'entry warm /consent']);
});

test('crashlytics: 들어온 주소가 길면 120자까지만 남긴다', () => {
  markEntryPath('actingapp://' + 'a'.repeat(300), true);
  assert.equal(crash.attributes.entry_path.length, 120);
  assert.equal(crash.logs[0], `entry cold ${crash.attributes.entry_path}`);
});

test('crashlytics: 모듈이 없는 빌드에서는 아무것도 남기지 않고 예외도 없다', async () => {
  crash.installed = false;
  await initCrashlytics();
  recordHandledError(new Error('x'));
  markScreen('/');
  markEntryPath('actingapp://entry/12', true);
  assert.deepEqual(crash, { installed: false, attributes: {}, logs: [], errors: [] });
});

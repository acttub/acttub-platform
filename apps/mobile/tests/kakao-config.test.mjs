import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const configure = require('../app.config.js');
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const pluginName = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);
const KAKAO = '@react-native-seoul/kakao-login';

function evaluate(key) {
  const previous = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY;
  try {
    if (key === undefined) delete process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY;
    else process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = key;
    return configure({ config: structuredClone(appJson) });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY;
    else process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = previous;
  }
}

test('카카오 네이티브 앱 키가 없거나 공백이면 카카오 플러그인을 넣지 않는다', () => {
  for (const key of [undefined, '', '   ']) {
    assert.equal(evaluate(key).plugins.some((plugin) => pluginName(plugin) === KAKAO), false);
  }
});

test('키가 있으면 같은 키로 카카오 플러그인을 한 번만 넣는다', () => {
  const plugins = evaluate(' abc123 ').plugins.filter((plugin) => pluginName(plugin) === KAKAO);
  assert.deepEqual(plugins, [[KAKAO, { kakaoAppKey: 'abc123' }]]);
});

test('안드로이드 빌드는 카카오 SDK 저장소를 안다', () => {
  const [, props] = appJson.plugins.find((plugin) => pluginName(plugin) === 'expo-build-properties');
  assert.ok(props.android.extraMavenRepos.includes('https://devrepo.kakao.com/nexus/content/groups/public/'));
});

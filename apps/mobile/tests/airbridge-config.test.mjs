import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configure = require('../app.config.js');
const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const envKeys = [
  'EXPO_PUBLIC_API_URL', 'AIRBRIDGE_APP_TOKEN', 'AIRBRIDGE_ENVIRONMENT',
  'EAS_BUILD_PLATFORM', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
  'GOOGLE_SERVICE_INFO_PLIST', 'GOOGLE_SERVICES_JSON',
];
const pluginName = (plugin) => Array.isArray(plugin) ? plugin[0] : plugin;
const baseConfig = () => ({
  name: 'ACTTUB',
  ios: { bundleIdentifier: 'com.acttub.app' },
  android: { package: 'com.acttub.app', googleServicesFile: './google-services.json' },
  plugins: [
    '@react-native-firebase/app',
    ['react-native-fbsdk-next', { appID: 'test-meta-app' }],
    'expo-tracking-transparency',
    '@react-native-google-signin/google-signin',
  ],
});

function evaluate(env = {}, config = baseConfig()) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    Object.assign(process.env, env);
    return configure({ config });
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const airbridgePlugin = (config) => config.plugins.find((plugin) => pluginName(plugin) === 'airbridge-expo-sdk');

test('토큰 없는 로컬 설정도 네이티브 리소스를 생성할 플러그인을 포함한다', () => {
  const plugin = airbridgePlugin(evaluate());
  assert.equal(plugin[1].appName, 'acttub');
  assert.equal(plugin[1].appToken, 'airbridge-disabled-without-token');
  assert.equal(readJson('airbridge.json').sdkEnabled, false);
  assert.equal(readJson('airbridge.development.json').sdkEnabled, false);
});

test('운영 API 빌드에서 SDK 토큰이 없거나 공백이면 설정 단계에서 차단한다', () => {
  for (const token of [undefined, '', '   ']) {
    const env = { EXPO_PUBLIC_API_URL: 'https://acttub.com', AIRBRIDGE_ENVIRONMENT: 'production' };
    if (token !== undefined) env.AIRBRIDGE_APP_TOKEN = token;
    assert.throws(() => evaluate(env), /AIRBRIDGE_APP_TOKEN is required/);
  }
});

test('운영 API URL의 대소문자·공백·마지막 슬래시로 토큰 검사를 우회하지 못한다', () => {
  assert.throws(() => evaluate({ EXPO_PUBLIC_API_URL: ' HTTPS://ACTTUB.COM/ ', AIRBRIDGE_ENVIRONMENT: 'production' }), /AIRBRIDGE_APP_TOKEN is required/);
});

test('운영 설정은 환경변수로 받은 토큰을 정리해서 주입한다', () => {
  const result = evaluate({
    EXPO_PUBLIC_API_URL: 'https://acttub.com',
    AIRBRIDGE_ENVIRONMENT: 'production',
    AIRBRIDGE_APP_TOKEN: ' test-only-airbridge-token ',
  });
  assert.equal(airbridgePlugin(result)[1].appToken, 'test-only-airbridge-token');
});

test('기존 Meta·Firebase·ATT 플러그인과 앱 식별자는 유지한다', () => {
  const base = baseConfig();
  const result = evaluate({}, base);
  assert.deepEqual(result.plugins.slice(0, base.plugins.length), base.plugins);
  assert.equal(result.ios.bundleIdentifier, base.ios.bundleIdentifier);
  assert.equal(result.android.package, base.android.package);
  assert.equal(base.plugins.some((plugin) => pluginName(plugin) === 'airbridge-expo-sdk'), false);
});

test('설정을 다시 평가해도 Airbridge 플러그인이 중복되지 않는다', () => {
  const result = evaluate({}, evaluate());
  assert.equal(result.plugins.filter((plugin) => pluginName(plugin) === 'airbridge-expo-sdk').length, 1);
});

test('Firebase 파일 주입과 Google iOS URL 스킴 보정을 보존한다', () => {
  const result = evaluate({
    GOOGLE_SERVICE_INFO_PLIST: '/tmp/test-google.plist',
    GOOGLE_SERVICES_JSON: '/tmp/test-google.json',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    EAS_BUILD_PLATFORM: 'ios',
  });
  assert.equal(result.ios.googleServicesFile, '/tmp/test-google.plist');
  assert.equal(result.android.googleServicesFile, '/tmp/test-google.json');
  assert.deepEqual(result.plugins.find((plugin) => pluginName(plugin) === '@react-native-google-signin/google-signin'), [
    '@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.test-client' },
  ]);
});

test('EAS 각 프로필의 Airbridge 환경은 API 대상과 일치한다', () => {
  const { build } = readJson('eas.json');
  for (const [profile, settings] of Object.entries(build)) {
    const production = settings.env.EXPO_PUBLIC_API_URL === 'https://acttub.com';
    const environment = production ? 'production' : 'development';
    assert.equal(settings.env.AIRBRIDGE_ENVIRONMENT, environment, profile);
    assert.equal(readJson(`airbridge.${environment}.json`).sdkEnabled, production, profile);
    assert.equal(Object.hasOwn(settings.env, 'AIRBRIDGE_APP_TOKEN'), false, profile);
  }
});

test('SDK 설정에서 기존 ATT 대기·동의 동작을 덮어쓰지 않는다', () => {
  for (const file of ['airbridge.json', 'airbridge.development.json', 'airbridge.production.json']) {
    const settings = readJson(file);
    assert.equal(Object.hasOwn(settings, 'autoDetermineTrackingAuthorizationTimeoutInSecond'), false, file);
    assert.equal(Object.hasOwn(settings, 'autoStartTrackingEnabled'), false, file);
  }
});

test('Meta 설치 출처 설정은 운영 SDK에만 적용한다', () => {
  assert.equal(readJson('airbridge.production.json').metaInstallReferrerAppID, '1535408487870893');
  assert.equal(Object.hasOwn(readJson('airbridge.development.json'), 'metaInstallReferrerAppID'), false);
});

test('API 환경과 Airbridge 환경이 다르면 수집 설정을 거부한다', () => {
  for (const env of [
    { EXPO_PUBLIC_API_URL: 'https://dev.acttub.com', AIRBRIDGE_ENVIRONMENT: 'production' },
    { EXPO_PUBLIC_API_URL: 'https://acttub.com', AIRBRIDGE_ENVIRONMENT: 'development', AIRBRIDGE_APP_TOKEN: 'test-token' },
    { EXPO_PUBLIC_API_URL: 'https://acttub.com', AIRBRIDGE_APP_TOKEN: 'test-token' },
    { AIRBRIDGE_ENVIRONMENT: 'production', AIRBRIDGE_APP_TOKEN: 'test-token' },
  ]) assert.throws(() => evaluate(env), /AIRBRIDGE_ENVIRONMENT must match/);
});

test('알 수 없는 SDK 환경이나 공백을 포함한 값의 조용한 폴백을 차단한다', () => {
  for (const environment of ['staging', ' production ', ' ']) {
    assert.throws(() => evaluate({ AIRBRIDGE_ENVIRONMENT: environment }), /AIRBRIDGE_ENVIRONMENT must be/);
  }
});

test('SDK 플러그인과 동일하게 환경명의 대소문자를 처리한다', () => {
  const result = evaluate({ EXPO_PUBLIC_API_URL: 'https://acttub.com', AIRBRIDGE_ENVIRONMENT: 'PRODUCTION', AIRBRIDGE_APP_TOKEN: 'test-token' });
  assert.equal(airbridgePlugin(result)[1].appToken, 'test-token');
});

test('운영 및 운영 내부 배포는 EAS production 변수 세트를 선택한다', () => {
  const { build } = readJson('eas.json');
  for (const profile of ['production', 'preview-prod']) {
    assert.equal(build[profile].environment, 'production', profile);
  }
  // 개발 계열의 기존 EAS 변수 선택 동작은 바꾸지 않는다.
  for (const profile of ['development', 'preview', 'testflight-dev']) {
    assert.equal(Object.hasOwn(build[profile], 'environment'), false, profile);
  }
});

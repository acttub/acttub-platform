import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { addKakaoOpenUrl, KAKAO_LINE } = require('../plugins/with-kakao-open-url.js');

// Expo SDK 58 템플릿(expo-template-bare-minimum@58)의 AppDelegate 모양 — application(_:open:options:) 이 없다.
const SDK58 = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test('카카오톡 로그인 복귀: SDK 58 AppDelegate 에 URL 을 받는 메서드를 만들고 카카오 처리 줄을 한 번 넣는다', () => {
  const out = addKakaoOpenUrl(SDK58);
  assert.match(out, /public override func application\(\n\s+_ app: UIApplication,\n\s+open url: URL,/);
  assert.equal(out.split(KAKAO_LINE).length - 1, 1);
  assert.match(out, /return super\.application\(app, open: url, options: options\)/);
  assert.match(out, /^internal import Expo\nimport kakao_login$/m);
  assert.equal(addKakaoOpenUrl(out), out, '두 번 돌아도 그대로다');
});

test('카카오톡 로그인 복귀: 메서드가 이미 있으면 건드리지 않는다(카카오 플러그인이 그 안에 끼운다)', () => {
  const withMethod = SDK58.replace('}\n}\n', '}\n  public override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool { true }\n}\n');
  assert.equal(addKakaoOpenUrl(withMethod), withMethod);
});

test('카카오톡 로그인 복귀: 넣는 줄은 카카오 플러그인이 찾는 줄과 같다 — 다르면 두 줄이 들어간다', () => {
  const plugin = readFileSync(new URL('../node_modules/@react-native-seoul/kakao-login/plugins/ios/withIosKakaoLogin.js', import.meta.url), 'utf8');
  assert.ok(plugin.includes(`'${KAKAO_LINE}'`));
});

test('카카오톡 로그인 복귀: 템플릿이 바뀌어 넣을 자리를 못 찾으면 prebuild 를 멈춘다', () => {
  assert.throws(() => addKakaoOpenUrl('class AppDelegate {}'), /didFinishLaunchingWithOptions/);
});

test('카카오톡 로그인 복귀: 카카오 키가 있는 빌드에만 붙는다', () => {
  const config = readFileSync(new URL('../app.config.js', import.meta.url), 'utf8');
  assert.match(config, /if \(kakaoAppKey\) plugins\.push\(\[KAKAO_LOGIN, \{ kakaoAppKey \}\], '\.\/plugins\/with-kakao-open-url\.js'\)/);
});

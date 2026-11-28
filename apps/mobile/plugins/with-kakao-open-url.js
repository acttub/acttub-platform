// 카카오톡 앱으로 로그인하고 돌아오는 URL 을 카카오 SDK 에 넘긴다(iOS).
// @react-native-seoul/kakao-login 플러그인은 AppDelegate 의 application(_:open:options:) 안에 처리 줄을 끼운다.
// Expo SDK 58 의 AppDelegate 템플릿은 장면 기반이라 이 메서드가 없고, 그 플러그인은 아무 말 없이 건너뛴다.
// URL 은 SceneDelegate 가 받아 AppDelegate 의 같은 메서드로 넘기므로(https://expo.fyi/ios-scene-lifecycle),
// 같은 처리 줄을 담은 재정의를 만든다. 카카오 플러그인이 먼저 돌든 나중에 돌든 줄은 한 번만 들어간다.
const { withAppDelegate } = require('@expo/config-plugins');

const KAKAO_LINE = 'if kakao_login.RNKakaoLogins.isKakaoTalkLoginUrl(url) { return kakao_login.RNKakaoLogins.handleOpen(url) }';
const KAKAO_IMPORT = 'import kakao_login';
const ANCHOR = /(return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)\n  \}\n)/;

const METHOD = `
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    ${KAKAO_LINE}
    return super.application(app, open: url, options: options)
  }
`;

function addKakaoOpenUrl(contents) {
  // 템플릿이나 다른 플러그인이 이미 메서드를 두었으면 카카오 플러그인이 그 안에 줄을 끼운다.
  if (contents.includes('open url: URL')) return contents;
  if (!ANCHOR.test(contents)) {
    throw new Error('with-kakao-open-url: AppDelegate 의 didFinishLaunchingWithOptions 끝을 찾지 못했다');
  }
  let next = contents.replace(ANCHOR, `$1${METHOD}`);
  if (!next.includes(KAKAO_IMPORT)) next = next.replace(/^((?:internal )?import Expo)$/m, `$1\n${KAKAO_IMPORT}`);
  return next;
}

module.exports = function withKakaoOpenUrl(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language === 'swift') cfg.modResults.contents = addKakaoOpenUrl(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.addKakaoOpenUrl = addKakaoOpenUrl;
module.exports.KAKAO_LINE = KAKAO_LINE;

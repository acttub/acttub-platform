// app.json을 베이스로, 플랫폼별 iOS 설정을 동적으로 덧씌운다.
//
// ▶ iOS 빌드(EAS_BUILD_PLATFORM === 'ios')에서는 Firebase(애널리틱스)를 제외한다.
//   이유: @react-native-firebase + useFrameworks(static) + New Architecture 조합이
//   Xcode에서 모듈 충돌(non-modular header / RCTBridgeModule import)로 컴파일 실패한다.
//   analytics는 가드 래퍼(lib/analytics.ts)라 네이티브 모듈이 없으면 조용히 no-op → 앱은 정상 동작.
//   (안드로이드는 그대로 Firebase 유지 — 이미 잘 빌드/동작함)
//
// ▶ google-signin iosUrlScheme: iOS OAuth 클라 ID(462 프로젝트)에서 reversed로 도출해 주입.

const GOOGLE_PLIST = './GoogleService-Info.plist';
const GOOGLE_SIGNIN = '@react-native-google-signin/google-signin';

// iOS 빌드에서 제거할 플러그인들 = Firebase만.
// (useFrameworks static + non-modular 플러그인은 google-signin의 pod install/컴파일에 필요하므로 유지.
//  지난 빌드에서 static framework 켰을 때만 pod install이 통과했음.)
const STRIP_ON_IOS = [
  '@react-native-firebase/app',
  '@react-native-firebase/analytics',
];

// "462...-xxx.apps.googleusercontent.com" → "com.googleusercontent.apps.462...-xxx"
function reversedClientId(iosClientId) {
  if (!iosClientId) return null;
  const core = iosClientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${core}`;
}

const pluginName = (pl) => (Array.isArray(pl) ? pl[0] : pl);

module.exports = ({ config }) => {
  const isIOSBuild = process.env.EAS_BUILD_PLATFORM === 'ios';
  const rev = reversedClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

  let plugins = (config.plugins || []).map((pl) => {
    if (pluginName(pl) === GOOGLE_SIGNIN) {
      return rev ? [GOOGLE_SIGNIN, { iosUrlScheme: rev }] : pl;
    }
    return pl;
  });

  const ios = { ...config.ios };

  if (isIOSBuild) {
    plugins = plugins.filter((pl) => !STRIP_ON_IOS.includes(pluginName(pl)));
    delete ios.googleServicesFile; // Firebase 제외했으니 plist 참조도 제거
  } else {
    ios.googleServicesFile = GOOGLE_PLIST;
  }

  return { ...config, ios, plugins };
};

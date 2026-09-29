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
const AIRBRIDGE = 'airbridge-expo-sdk';
const AIRBRIDGE_APP_NAME = 'acttub';
const AIRBRIDGE_DISABLED_TOKEN = 'airbridge-disabled-without-token';

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
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://dev.acttub.com')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
  const airbridgeToken = process.env.AIRBRIDGE_APP_TOKEN?.trim();
  // SDK 플러그인과 동일하게 환경명을 소문자로 읽는다. 지원하지 않는 값은 기본 파일로
  // 조용히 폴백하지 않게 막아, 운영 수집 누락이나 개발 데이터 혼입을 예방한다.
  const airbridgeEnvironment = process.env.AIRBRIDGE_ENVIRONMENT?.toLowerCase() || 'development';
  if (!['development', 'production'].includes(airbridgeEnvironment)) {
    throw new Error('AIRBRIDGE_ENVIRONMENT must be development or production');
  }
  const isProductionAirbridge = airbridgeEnvironment === 'production';
  if ((apiUrl === 'https://acttub.com') !== isProductionAirbridge) {
    throw new Error('AIRBRIDGE_ENVIRONMENT must match EXPO_PUBLIC_API_URL');
  }

  // App SDK Token은 EAS production 환경의 Sensitive 변수로 주입한다. Secret은 로컬
  // EAS CLI 설정 평가에 보이지 않는다. 실제 토큰을 소스나 eas.json에는 남기지 않는다.
  // 개발/로컬은 SDK를 끄되, 자동 네이티브 초기화에 필요한 리소스는 대체값으로 생성한다.
  if (isProductionAirbridge && !airbridgeToken) {
    throw new Error('AIRBRIDGE_APP_TOKEN is required for production mobile builds');
  }

  let plugins = (config.plugins || []).map((pl) => {
    if (pluginName(pl) === GOOGLE_SIGNIN) {
      return rev ? [GOOGLE_SIGNIN, { iosUrlScheme: rev }] : pl;
    }
    return pl;
  });

  // Expo 플러그인이 Android Application / iOS AppDelegate에서 SDK를 자동 초기화한다.
  // 따라서 별도 JS initialize 호출은 두지 않는다. 플러그인은 항상 넣어 네이티브 리소스를
  // 만들고, 토큰이 없는 개발 빌드는 airbridge.development.json의 sdkEnabled=false로 막는다.
  plugins = plugins.filter((pl) => pluginName(pl) !== AIRBRIDGE);
  plugins.push([
    AIRBRIDGE,
    {
      appName: AIRBRIDGE_APP_NAME,
      appToken: airbridgeToken || AIRBRIDGE_DISABLED_TOKEN,
    },
  ]);

  const ios = { ...config.ios };

  // iOS에도 Firebase(애널리틱스) 유지 — $RNFirebaseAsStaticFramework=true(plugins/with-rnfirebase-static)로
  // useFrameworks(static)+New Arch 컴파일 충돌을 해결한다. (과거엔 iOS에서 제외했었음)
  // 모노레포에서 GoogleService-Info.plist는 gitignore라 EAS 빌더에 안 올라간다(git-tracked만 업로드).
  // → EAS 파일 환경변수(GOOGLE_SERVICE_INFO_PLIST, secret)로 주입하고, 없으면 로컬 경로 폴백.
  ios.googleServicesFile = process.env.GOOGLE_SERVICE_INFO_PLIST || GOOGLE_PLIST;
  void isIOSBuild; // 더 이상 플랫폼별 firebase strip 안 함

  // 모노레포에서 google-services.json은 gitignore라 EAS 빌더에 안 올라간다.
  // EAS 파일 환경변수(GOOGLE_SERVICES_JSON, secret)로 주입하고, 없으면 app.json 로컬 경로 폴백.
  const android = { ...config.android };
  if (process.env.GOOGLE_SERVICES_JSON) {
    android.googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  }

  return { ...config, ios, android, plugins };
};

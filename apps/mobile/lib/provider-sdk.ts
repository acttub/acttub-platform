import { NativeModules, Platform } from 'react-native';

import {
  LOGIN_PROVIDERS,
  type LoginProvider,
  type ProviderCredential,
} from '@/lib/login-flow';
import { NAVER_APP_RETURN_URL, naverAuthRequest, naverCallbackCode } from '@/lib/naver-login';

/**
 * 로그인 제공자 SDK와 앱 사이의 이음매(account.login).
 *
 * 제공자마다 어댑터 하나가 "이 빌드에서 쓸 수 있는가", "서버에 넘길 자격 값 받기", "제공자
 * 세션 정리"를 맡는다. 로그인 화면은 서버가 켠 제공자 중 여기서 쓸 수 있다고 답한 것만
 * 버튼으로 그린다.
 *
 * 카카오는 네이티브 SDK로 OIDC ID 토큰을 받고(결정 I-4), 네이버는 네이티브 SDK가 아니라
 * 브라우저 인증 세션(PKCE S256 + state)으로 authorization code를 받아 서버에 넘긴다(결정 I-5).
 * 그때 쓴 state도 자격 값에 실어 서버가 토큰 교환에 쓰게 한다. 두 제공자는 빌드 때 공개 설정값
 * (카카오 네이티브 앱 키·네이버 client id)이 있어야 켜진다 — 없으면 버튼이 그려지지 않는다.
 * 설정값은 앱 번들에 들어가는 공개값(EXPO_PUBLIC_*)만 쓴다 — client secret처럼 비밀인 값은
 * 앱에 넣지 않는다.
 */
export type ProviderAdapter = {
  isAvailable: () => Promise<boolean>;
  /** 사용자가 취소하면 null. */
  signIn: () => Promise<ProviderCredential | null>;
  /** 로그아웃 때의 제공자 세션 정리. 연결은 그대로 둔다. */
  signOut: () => Promise<void>;
  /**
   * 탈퇴 직전의 연결 해제 — 제공자의 "연결된 서비스" 목록에서 Acttub 을 뺀다. 앱이 SDK 로
   * 끊는 제공자(구글)에만 있다. 애플·카카오·네이버는 서버가 끊는다(결정 I-7).
   */
  disconnect?: () => Promise<void>;
};

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
// iOS 전용 OAuth 클라이언트 ID(462... 프로젝트). plist에 없어서 명시적으로 넣어야 함.
// 없으면(안드로이드) undefined → 무시됨.
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;

// 네이티브 모듈이 없는 환경(재빌드 전 dev client·웹)에서도 앱이 뜨도록 가드해서 로드.
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleSigninModule | null = null;
try {
  google = require('@react-native-google-signin/google-signin');
  google?.GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  });
} catch {
  google = null;
}

// Apple 로그인(iOS 전용). 네이티브 모듈 없으면(안드로이드·재빌드 전) null.
type AppleModule = typeof import('expo-apple-authentication');
let apple: AppleModule | null = null;
if (Platform.OS === 'ios') {
  try {
    apple = require('expo-apple-authentication');
  } catch {
    apple = null;
  }
}

const googleAdapter: ProviderAdapter = {
  isAvailable: async () => google !== null,
  /** signIn 응답 형태가 버전마다 달라(idToken 위치) 방어적으로 추출한다. */
  async signIn() {
    if (!google) throw new Error('Google Sign-In native module is missing from this build');
    const { GoogleSignin } = google;
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = (await GoogleSignin.signIn()) as {
      type?: string;
      idToken?: string | null;
      user?: { name?: string | null; givenName?: string | null } | null;
      data?: {
        idToken?: string | null;
        user?: { name?: string | null; givenName?: string | null } | null;
      } | null;
    };
    if (result?.type === 'cancelled') return null;
    let idToken = result?.data?.idToken ?? result?.idToken ?? null;
    if (!idToken) {
      const tokens = await GoogleSignin.getTokens();
      idToken = tokens.idToken;
    }
    if (!idToken) return null;
    const profile = result?.data?.user ?? result?.user ?? null;
    return {
      provider: 'google',
      idToken,
      displayName: profile?.givenName ?? profile?.name ?? null,
    };
  },
  async signOut() {
    if (google) await google.GoogleSignin.signOut();
  },
  // 서버는 구글의 ID 토큰만 받아서 끊을 수단이 없다. 이 폰에 구글 세션이 없으면(다른
  // 제공자로 로그인했으면) SDK 가 던지고, 부르는 쪽이 삼킨다 — 해제가 실패해도 탈퇴는 간다.
  async disconnect() {
    if (google) await google.GoogleSignin.revokeAccess();
  },
};

const appleAdapter: ProviderAdapter = {
  async isAvailable() {
    if (!apple) return false;
    return apple.isAvailableAsync().catch(() => false);
  },
  async signIn() {
    if (!apple) throw new Error('Apple Authentication native module is missing from this build');
    let credential: import('expo-apple-authentication').AppleAuthenticationCredential;
    try {
      credential = await apple.signInAsync({
        requestedScopes: [
          apple.AppleAuthenticationScope.FULL_NAME,
          apple.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return null; // 사용자가 취소
      throw err;
    }
    if (!credential.identityToken) throw new Error('Apple sign-in returned no identity token');
    return {
      provider: 'apple',
      idToken: credential.identityToken,
      // 5분 동안 한 번만 쓸 수 있다. 서버가 로그인 요청에서 바로 애플 토큰으로 바꾼다.
      authorizationCode: credential.authorizationCode,
      // Apple은 최초 1회만 이름을 준다 — 프로필 화면까지 들고 간다.
      displayName:
        [credential.fullName?.familyName, credential.fullName?.givenName]
          .filter(Boolean)
          .join('') || null,
    };
  },
  // 애플은 앱에서 정리할 제공자 세션이 없다.
  signOut: async () => undefined,
};

// 카카오(네이티브 SDK). 앱 키는 app.config.js 가 같은 값으로 네이티브 설정(Info.plist·매니페스트)에
// 넣는다. 키가 없는 빌드는 플러그인도 빠지므로 모듈을 아예 부르지 않는다. JS 모듈은 네이티브
// 모듈이 없어도 불러와지므로(재빌드 전 dev client) 네이티브 쪽 존재도 따로 본다.
const KAKAO_NATIVE_APP_KEY = (process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? '').trim();
type KakaoModule = typeof import('@react-native-seoul/kakao-login');
let kakao: KakaoModule | null = null;
if (KAKAO_NATIVE_APP_KEY) {
  try {
    kakao = require('@react-native-seoul/kakao-login');
  } catch {
    kakao = null;
  }
}

/** 카카오 SDK 의 취소는 코드가 아니라 메시지로만 구분된다(iOS "ClientFailed(Cancelled)", 안드로이드 "user cancelled", 동의 거절 access_denied). */
function isKakaoCancel(err: unknown): boolean {
  const message = String((err as { message?: unknown })?.message ?? '');
  return /cancel|access_?denied/i.test(message);
}

const kakaoAdapter: ProviderAdapter = {
  isAvailable: async () => kakao !== null && NativeModules.RNKakaoLogins != null,
  /**
   * 카카오톡이 있으면 카카오톡으로, 없거나 카카오톡 로그인이 실패하면 카카오계정(브라우저) 로그인으로
   * 넘어간다 — SDK 래퍼의 login() 이 그렇게 한다. 서버는 ID 토큰만 받는다(aud = 네이티브 앱 키).
   */
  async signIn() {
    if (!kakao) throw new Error('Kakao login native module is missing from this build');
    let token: { idToken?: string | null };
    try {
      token = await kakao.login();
    } catch (err) {
      if (isKakaoCancel(err)) return null;
      throw err;
    }
    // ID 토큰은 카카오 콘솔에서 OpenID Connect 를 켜야 나온다.
    if (!token?.idToken) throw new Error('Kakao sign-in returned no ID token (is OpenID Connect enabled?)');
    return { provider: 'kakao', idToken: token.idToken };
  },
  // 기기의 카카오 토큰만 지운다. 연결 끊기는 탈퇴 때 서버가 어드민 키로 한다(결정 I-7).
  async signOut() {
    if (kakao) await kakao.logout();
  },
};

// 네이버(브라우저 인증 세션). 콜백은 API 와 같은 호스트의 웹 페이지이고(lib/naver-login.ts),
// 그 페이지가 결과를 앱 스킴으로 넘긴다.
const NAVER_CLIENT_ID = (process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '').trim();
const API_URL = process.env.EXPO_PUBLIC_API_URL;
type NaverModules = {
  browser: typeof import('expo-web-browser');
  crypto: typeof import('expo-crypto');
};
let naverModules: NaverModules | null = null;
if (NAVER_CLIENT_ID) {
  try {
    naverModules = { browser: require('expo-web-browser'), crypto: require('expo-crypto') };
  } catch {
    naverModules = null;
  }
}

const naverAdapter: ProviderAdapter = {
  isAvailable: async () => naverModules !== null,
  async signIn() {
    if (!naverModules) throw new Error('Naver login needs expo-web-browser and expo-crypto in this build');
    const { browser, crypto } = naverModules;
    const request = await naverAuthRequest({
      clientId: NAVER_CLIENT_ID,
      apiUrl: API_URL,
      crypto: {
        randomBytes: (count) => crypto.getRandomBytes(count),
        sha256: async (data) =>
          new Uint8Array(await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, data)),
      },
    });
    const result = await browser.openAuthSessionAsync(request.url, NAVER_APP_RETURN_URL);
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success') throw new Error(`Naver sign-in session ended: ${result.type}`);
    const code = naverCallbackCode(result.url, request.state);
    if (code === null) return null;
    return {
      provider: 'naver',
      authorizationCode: code,
      codeVerifier: request.codeVerifier,
      redirectUri: request.redirectUri,
      state: request.state,
    };
  },
  // 앱이 들고 있는 네이버 세션이 없다. 브라우저 쿠키는 네이버가 관리한다.
  signOut: async () => undefined,
};

const adapters: Record<LoginProvider, ProviderAdapter> = {
  google: googleAdapter,
  apple: appleAdapter,
  kakao: kakaoAdapter,
  naver: naverAdapter,
};

export function providerAdapter(provider: LoginProvider): ProviderAdapter {
  return adapters[provider];
}

/** 이 빌드가 실제로 로그인시킬 수 있는 제공자. */
export async function supportedProviders(): Promise<LoginProvider[]> {
  const available = await Promise.all(
    LOGIN_PROVIDERS.map((provider) => adapters[provider].isAvailable().catch(() => false)),
  );
  return LOGIN_PROVIDERS.filter((_, index) => available[index]);
}

/** 탈퇴 요청 직전에 부른다. 앱이 SDK 로 끊을 수 있는 제공자의 연결을 해제한다. */
export async function disconnectProviders(): Promise<void> {
  await Promise.allSettled(
    LOGIN_PROVIDERS.map((provider) => adapters[provider].disconnect?.() ?? Promise.resolve()),
  );
}

/** 로그아웃·탈퇴 때 제공자 세션을 정리한다. 하나가 실패해도 나머지는 정리한다. */
export async function signOutProviders(): Promise<void> {
  await Promise.allSettled(LOGIN_PROVIDERS.map((provider) => adapters[provider].signOut()));
}

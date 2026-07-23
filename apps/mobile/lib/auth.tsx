import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, type AuthUser, type ConsentDocument, type TokenPair } from '@/lib/api';
import { signOutBestEffort } from '@/lib/auth-session';
import {
  clearTokens,
  getRefreshToken,
  getStoredUser,
  loadTokens,
  onConsentRequired,
  onTokensCleared,
  setTokens,
} from '@/lib/token-store';

/**
 * 인증 상태 컨텍스트.
 * - 앱 시작 시 저장된 토큰을 로드해 로그인 여부를 판단(status).
 * - Google 로그인으로 id_token을 받아 v2 /auth/login과 교환.
 * - refresh 실패/로그아웃으로 토큰이 비워지면(onTokensCleared) 자동으로 signedOut.
 */

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
// iOS 전용 OAuth 클라이언트 ID(462... 프로젝트). plist에 없어서 명시적으로 넣어야 함.
// 없으면(안드로이드) undefined → 무시됨.
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;

type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  pendingConsents: ConsentDocument[];
  consentRequired: boolean;
  signInWithGoogle: () => Promise<void>;
  /** iOS Sign in with Apple. isAvailableAsync가 true일 때만 노출. */
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 약관 화면에서 필수 동의를 모두 마친 뒤 호출 → 게이트 통과. */
  clearPendingConsents: () => void;
  refreshPendingConsents: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// 네이티브 모듈이 없는 환경(재빌드 전 dev client·웹)에서도 앱이 뜨도록 가드해서 로드.
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleSigninModule | null = null;
try {
  google = require('@react-native-google-signin/google-signin');
  google?.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID });
} catch {
  google = null;
}

// Apple 로그인(iOS 전용). 네이티브 모듈 없으면(안드로이드·재빌드 전) null.
type AppleModule = typeof import('expo-apple-authentication');
let apple: AppleModule | null = null;
try {
  apple = require('expo-apple-authentication');
} catch {
  apple = null;
}

/** signIn 응답 형태가 버전마다 달라(idToken 위치) 방어적으로 추출한다. */
async function getGoogleIdToken(): Promise<string | null> {
  if (!google) throw new Error('구글 로그인 모듈이 없어요. 개발 빌드를 다시 설치해주세요.');
  const { GoogleSignin } = google;
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = (await GoogleSignin.signIn()) as {
    type?: string;
    idToken?: string | null;
    data?: { idToken?: string | null } | null;
  };
  if (result?.type === 'cancelled') return null;
  let idToken = result?.data?.idToken ?? result?.idToken ?? null;
  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens.idToken;
  }
  return idToken;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingConsents, setPendingConsents] = useState<ConsentDocument[]>([]);
  const [consentRequired, setConsentRequired] = useState(false);

  const refreshPendingConsents = useCallback(async () => {
    const { documents } = await api.pendingConsents();
    setPendingConsents(documents);
    setConsentRequired(documents.length > 0);
  }, []);

  useEffect(() => {
    let active = true;
    loadTokens().then((hasToken) => {
      if (active) {
        setUser(hasToken ? getStoredUser() : null);
        setStatus(hasToken ? 'signedIn' : 'signedOut');
      }
    });
    const unsubTokens = onTokensCleared(() => {
      setUser(null);
      setPendingConsents([]);
      setConsentRequired(false);
      setStatus('signedOut');
    });
    const unsubConsent = onConsentRequired(() => {
      setConsentRequired(true);
      void refreshPendingConsents().catch(() => undefined);
    });
    return () => {
      active = false;
      unsubTokens();
      unsubConsent();
    };
  }, [refreshPendingConsents]);

  const finishLogin = useCallback(async (pair: TokenPair) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        '[auth] pending_consents:',
        pair.pending_consents?.length ?? 0,
        (pair.pending_consents ?? []).map((c) => `${c.type}${c.required ? '(필수)' : ''}`),
      );
    }
    await setTokens(pair.access_token, pair.refresh_token, pair.user);
    setUser(pair.user);
    setPendingConsents(pair.pending_consents ?? []);
    setConsentRequired(false);
    setStatus('signedIn');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const idToken = await getGoogleIdToken();
    if (!idToken) return; // 사용자가 취소
    await finishLogin(await api.login('google', idToken));
  }, [finishLogin]);

  const signInWithApple = useCallback(async () => {
    if (!apple) throw new Error('이 기기에서는 Apple 로그인을 쓸 수 없어요.');
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
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return; // 사용자가 취소
      throw err;
    }
    if (!credential.identityToken) throw new Error('Apple 로그인 토큰을 받지 못했어요.');
    await finishLogin(await api.login('apple', credential.identityToken));
  }, [finishLogin]);

  const signOut = useCallback(async () => {
    const rt = getRefreshToken();
    await signOutBestEffort({
      serverLogout: async () => {
        if (rt) await api.logout(rt);
      },
      providerLogout: async () => {
        if (google) await google.GoogleSignin.signOut();
      },
      clearLocalSession: clearTokens,
    });
    setUser(null);
    setStatus('signedOut');
  }, []);

  const clearPendingConsents = useCallback(() => {
    setPendingConsents([]);
    setConsentRequired(false);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      pendingConsents,
      consentRequired,
      signInWithGoogle,
      signInWithApple,
      signOut,
      clearPendingConsents,
      refreshPendingConsents,
    }),
    [
      status,
      user,
      pendingConsents,
      consentRequired,
      signInWithGoogle,
      signInWithApple,
      signOut,
      clearPendingConsents,
      refreshPendingConsents,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

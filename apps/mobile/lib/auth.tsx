import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  api,
  type AuthUser,
  type ConsentDocument,
  type ConsentEntryResponse,
  type TokenPair,
} from '@/lib/api';
import { signOutBestEffort } from '@/lib/auth-session';
import { createConsentEntrySession } from '@/lib/consent-entry';
import { getUserName, saveUserName } from '@/lib/profile';
import { clearLocalAccountData } from '@/lib/local-account-data';
import { detachPushFromAccount, syncPushRegistration } from '@/lib/notifications';
import {
  clearTokens,
  getRefreshToken,
  getStoredUser,
  loadTokens,
  onAccountDeactivated,
  onConsentRequired,
  onStoredUserChanged,
  onTokensCleared,
  setTokens,
} from '@/lib/token-store';

/**
 * 인증 상태 컨텍스트.
 * - 앱 시작 시 저장된 토큰을 로드해 로그인 여부를 판단(status).
 * - Google 로그인으로 id_token을 받아 v2 /auth/login과 교환.
 * - 새 로그인과 저장 세션 복원 모두 동의 진입 판정을 한 번 확인.
 * - refresh 실패/로그아웃으로 토큰이 비워지면(onTokensCleared) 자동으로 signedOut.
 */

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
// iOS 전용 OAuth 클라이언트 ID(462... 프로젝트). plist에 없어서 명시적으로 넣어야 함.
// 없으면(안드로이드) undefined → 무시됨.
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;

type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export type ConsentEntryState =
  | { status: 'checking'; entry: null; error: null }
  | { status: 'error'; entry: null; error: unknown }
  | {
      status: 'allowed' | 'decision_required' | 'blocked';
      entry: ConsentEntryResponse;
      error: null;
    };

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  consentEntry: ConsentEntryState;
  profileSetupRequired: boolean;
  signInWithGoogle: () => Promise<void>;
  /** iOS Sign in with Apple. isAvailableAsync가 true일 때만 노출. */
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * 회원탈퇴. 서버에 파기를 요청하고, 성공하면 이 기기에 남은 것까지 지운다.
   * 되돌릴 수 없다 — 부르기 전에 반드시 확인을 받는다.
   */
  deleteAccount: () => Promise<void>;
  refreshConsentEntry: () => Promise<ConsentEntryResponse>;
  completeProfileSetup: (name: string) => Promise<void>;
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
type GoogleSignInResult = {
  idToken: string | null;
  /** 구글 계정 표시 이름 — 저장된 이름이 없을 때 인사말에 쓴다([[display-name]]). */
  name: string | null;
};

async function getGoogleIdToken(): Promise<GoogleSignInResult | null> {
  if (!google) throw new Error('구글 로그인 모듈이 없어요. 개발 빌드를 다시 설치해주세요.');
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
  const profile = result?.data?.user ?? result?.user ?? null;
  return { idToken, name: profile?.givenName ?? profile?.name ?? null };
}

/** 아직 저장된 이름이 없을 때만 로그인 제공자가 준 이름을 채운다(사용자가 고친 이름을 덮지 않게). */
async function rememberProviderName(name: string | null | undefined): Promise<void> {
  const trimmed = name?.trim();
  if (!trimmed) return;
  try {
    const existing = await getUserName();
    if (existing?.trim()) return;
    await saveUserName(trimmed);
  } catch {
    // 이름은 부가정보라 실패해도 로그인을 막지 않는다.
  }
}

async function needsProfileSetup(): Promise<boolean> {
  try {
    return !(await getUserName())?.trim();
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [consentEntry, setConsentEntry] = useState<ConsentEntryState>({
    status: 'checking',
    entry: null,
    error: null,
  });
  const [profileSetupRequired, setProfileSetupRequired] = useState(false);
  const [consentEntrySession] = useState(() =>
    createConsentEntrySession({
      readEntry: () => api.consentEntry(),
      readPending: () => api.pendingConsents(),
    }),
  );
  const consentLoadGeneration = useRef(0);

  const loadConsentEntry = useCallback(
    async ({
      fallbackDocuments,
      refresh = false,
    }: {
      fallbackDocuments?: ConsentDocument[];
      refresh?: boolean;
    } = {}): Promise<ConsentEntryResponse> => {
      const generation = ++consentLoadGeneration.current;
      setConsentEntry({ status: 'checking', entry: null, error: null });
      try {
        const entry = refresh
          ? await consentEntrySession.refresh({ fallbackDocuments })
          : await consentEntrySession.readOnce({ fallbackDocuments });
        if (generation === consentLoadGeneration.current) {
          setConsentEntry({
            status: entry.entry_status,
            entry,
            error: null,
          });
        }
        return entry;
      } catch (error) {
        if (generation === consentLoadGeneration.current) {
          setConsentEntry({ status: 'error', entry: null, error });
        }
        throw error;
      }
    },
    [consentEntrySession],
  );

  const resetConsentEntry = useCallback(() => {
    consentLoadGeneration.current += 1;
    consentEntrySession.clear();
    setConsentEntry({ status: 'checking', entry: null, error: null });
  }, [consentEntrySession]);

  const refreshConsentEntry = useCallback(
    () => loadConsentEntry({ refresh: true }),
    [loadConsentEntry],
  );

  useEffect(() => {
    let active = true;
    loadTokens().then(async (hasToken) => {
      if (!active) return;
      if (!hasToken) {
        setUser(null);
        setStatus('signedOut');
        return;
      }
      const requireProfileSetup = await needsProfileSetup();
      if (!active) return;
      setUser(getStoredUser());
      setProfileSetupRequired(requireProfileSetup);
      setStatus('signedIn');
      void loadConsentEntry().catch(() => undefined);
    });
    const unsubTokens = onTokensCleared(() => {
      resetConsentEntry();
      setUser(null);
      setProfileSetupRequired(false);
      setStatus('signedOut');
    });
    const unsubConsent = onConsentRequired(() => {
      void refreshConsentEntry().catch(() => undefined);
    });
    // 다른 기기에서 탈퇴했거나, 탈퇴 후 액세스 토큰이 아직 만료되지 않은 경우.
    // refresh 로 풀 수 없으므로 세션을 끊는다.
    const unsubDeactivated = onAccountDeactivated(() => {
      void clearLocalAccountData().catch(() => undefined);
      void clearTokens();
    });
    const unsubStoredUser = onStoredUserChanged((nextUser) => {
      resetConsentEntry();
      setUser(nextUser);
      setProfileSetupRequired(true);
      setStatus('signedIn');
      void loadConsentEntry().catch(() => undefined);
      void needsProfileSetup().then(setProfileSetupRequired);
    });
    return () => {
      active = false;
      consentLoadGeneration.current += 1;
      unsubTokens();
      unsubConsent();
      unsubDeactivated();
      unsubStoredUser();
    };
  }, [loadConsentEntry, refreshConsentEntry, resetConsentEntry]);

  const finishLogin = useCallback(
    async (pair: TokenPair, requireProfileSetup: boolean) => {
      const committed = await setTokens(
        pair.access_token,
        pair.refresh_token,
        pair.user,
      );
      if (!committed) return;
      resetConsentEntry();
      setUser(pair.user);
      setProfileSetupRequired(requireProfileSetup);
      setStatus('signedIn');
      void loadConsentEntry({
        fallbackDocuments: pair.pending_consents ?? [],
      }).catch(() => undefined);
      // 푸시 등록은 로그인의 성패와 무관한 최선 노력 — 기다리지도, 실패를 올리지도 않는다.
      void syncPushRegistration();
    },
    [loadConsentEntry, resetConsentEntry],
  );

  const signInWithGoogle = useCallback(async () => {
    const signIn = await getGoogleIdToken();
    if (!signIn?.idToken) return; // 사용자가 취소
    const pair = await api.login('google', signIn.idToken);
    await rememberProviderName(signIn.name);
    await finishLogin(pair, await needsProfileSetup());
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
    const pair = await api.login('apple', credential.identityToken);
    // Apple은 최초 1회만 이름을 준다 — 그때 받아 저장해 둔다.
    await rememberProviderName(
      [credential.fullName?.familyName, credential.fullName?.givenName]
        .filter(Boolean)
        .join('') || credential.fullName?.givenName,
    );
    await finishLogin(pair, await needsProfileSetup());
  }, [finishLogin]);

  const signOut = useCallback(async () => {
    const rt = getRefreshToken();
    // 세션이 살아 있을 때 이 단말의 푸시 토큰을 서버에서 지운다 — 로그아웃 뒤에 오는
    // 알림은 다음 사용자의 화면에 뜬다. 실패해도 로그아웃은 계속 간다.
    await detachPushFromAccount().catch(() => undefined);
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

  const deleteAccount = useCallback(async () => {
    // 리마인드 예약과 로컬 토큰 기록을 먼저 걷는다. 서버 쪽 push_tokens 는 탈퇴
    // 트랜잭션이 전부 지우므로 여기 실패는 아무것도 남기지 않는다.
    await detachPushFromAccount().catch(() => undefined);
    // 서버가 먼저다. 여기서 실패하면(네트워크·서버 오류) 로컬을 지우지 않고 예외를
    // 올린다 — 계정은 살아 있는데 기기에서만 로그아웃되면 탈퇴한 줄 알고 떠난다.
    await api.deleteMe();
    // 성공한 뒤엔 실패해도 계속 간다. 계정은 이미 사라졌으므로 여기서 멈추면
    // 지워진 계정으로 로그인된 화면에 남는다.
    await clearLocalAccountData().catch(() => undefined);
    await signOutBestEffort({
      // 서버 로그아웃은 부르지 않는다 — refresh 는 탈퇴가 이미 전부 끊었다.
      serverLogout: async () => undefined,
      providerLogout: async () => {
        if (google) await google.GoogleSignin.signOut();
      },
      clearLocalSession: clearTokens,
    });
    setUser(null);
    setStatus('signedOut');
  }, []);

  const completeProfileSetup = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('이름을 입력해주세요.');
    await saveUserName(trimmed);
    setProfileSetupRequired(false);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      consentEntry,
      profileSetupRequired,
      signInWithGoogle,
      signInWithApple,
      signOut,
      deleteAccount,
      refreshConsentEntry,
      completeProfileSetup,
    }),
    [
      status,
      user,
      consentEntry,
      profileSetupRequired,
      signInWithGoogle,
      signInWithApple,
      signOut,
      deleteAccount,
      refreshConsentEntry,
      completeProfileSetup,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

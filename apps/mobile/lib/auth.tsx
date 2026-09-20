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
import { AppState } from 'react-native';

import {
  api,
  type AuthUser,
  type ConsentEntryResponse,
  type MeResponse,
  type TokenPair,
} from '@/lib/api';
import type { ProfileGateStatus } from '@/lib/app-bootstrap';
import { runLegacyScriptMigrationOnce } from '@/lib/reading/legacy-migration-runner';
import {
  signOutBestEffort,
  wipeClosedAccount,
  withdrawAccount,
  type ClosedAccountDependencies,
} from '@/lib/auth-session';
import { createConsentEntrySession } from '@/lib/consent-entry';
import {
  buildSignupDecisions,
  type ConsentChoice,
} from '@/lib/consent-entry-submission';
import { lastProviderStore } from '@/lib/last-provider';
import { clearAccountCache, clearLocalAccountData } from '@/lib/local-account-data';
import {
  isSignupExpired,
  loginRequestBody,
  resolveLoginOutcome,
  type LoginProvider,
  type PendingSignup,
} from '@/lib/login-flow';
import {
  cancelReminders,
  detachPushToken,
  forgetPushToken,
  syncNotificationsAfterGate,
  syncNotificationsOnForeground,
} from '@/lib/notifications';
import { saveUserName, setProviderNameHint } from '@/lib/profile';
import {
  profileGateStatus,
  type ProfilePayload,
} from '@/lib/profile-form';
import { disconnectProviders, providerAdapter, signOutProviders } from '@/lib/provider-sdk';
import { translate as t } from '@/lib/i18n';
import {
  clearTokens,
  getRefreshToken,
  getStoredUser,
  loadTokens,
  onAccountDeactivated,
  onConsentRequired,
  onProfileRequired,
  onStoredUserChanged,
  onTokensCleared,
  onUpdateRequired,
  setTokens,
} from '@/lib/token-store';

/**
 * 인증 상태 컨텍스트.
 * - 앱 시작 시 저장된 토큰을 로드해 로그인 여부를 판단(status).
 * - 제공자가 준 자격 값을 v2 /auth/login과 교환하고 응답의 result로 가른다. 이미 있는 계정은
 *   토큰을 받고, 처음 온 신원은 가입 토큰과 동의 문서를 들고 동의 화면으로 간다(signup).
 *   계정은 가입 제출이 통과한 순간 생긴다. 동의 화면에서 나가면 아무것도 남지 않는다.
 * - 새 로그인과 저장 세션 복원 모두 동의 진입 판정과 프로필 완성 여부를 서버에서 읽는다.
 *   게이트 순서는 인증 → 동의 → 프로필 → 탭이다(app-bootstrap).
 * - refresh 실패/로그아웃으로 토큰이 비워지면(onTokensCleared) 자동으로 signedOut.
 */

type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export type ConsentEntryState =
  | { status: 'checking'; entry: null; error: null }
  | { status: 'error'; entry: null; error: unknown }
  | {
      status: 'allowed' | 'decision_required';
      entry: ConsentEntryResponse;
      error: null;
    };

/** 서버에서 읽은 내 계정과 프로필. status가 프로필 게이트를 정한다. */
export type ProfileState = {
  status: ProfileGateStatus;
  me: MeResponse | null;
  error: unknown;
};

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  consentEntry: ConsentEntryState;
  profile: ProfileState;
  /** 처음 온 신원이 동의 화면에서 들고 있는 가입 토큰과 문서. 계정은 아직 없다. */
  signup: PendingSignup | null;
  /** 서버가 426으로 답했다. 업데이트 안내 화면만 보여 준다. */
  updateRequired: boolean;
  /** 로그인 화면으로 돌려보내며 남긴 안내(가입 토큰 만료, 만 14세 미만 등). */
  loginNotice: string | null;
  clearLoginNotice: () => void;
  signInWith: (provider: LoginProvider) => Promise<void>;
  /** 동의 화면의 "동의하고 계속하기". 통과하면 그 순간 계정이 생기고 로그인된다. */
  submitSignup: (choices: ReadonlyMap<string, ConsentChoice>) => Promise<void>;
  /** 보는 사이 새 판이 나왔을 때 가입 화면의 문서를 다시 받는다. */
  reloadSignupDocuments: () => Promise<void>;
  /** 가입 중의 동의 화면에서 나간다. 가입 토큰과 제공자가 준 이름을 버린다. */
  cancelSignup: (notice?: string) => void;
  signOut: () => Promise<void>;
  /**
   * 회원탈퇴. 서버에 파기를 요청하고, 성공하면 이 기기에 남은 것까지 지운다.
   * 되돌릴 수 없다 — 부르기 전에 반드시 확인을 받는다.
   */
  deleteAccount: () => Promise<void>;
  refreshConsentEntry: () => Promise<ConsentEntryResponse>;
  reloadProfile: () => Promise<void>;
  /** 프로필 여섯 항목을 저장한다. 가입 게이트에서는 저장이 곧 게이트 통과다. */
  saveProfile: (payload: ProfilePayload) => Promise<MeResponse>;
  /** 서버가 돌려준 내 계정(사진 올리기·지우기의 응답)을 그대로 반영한다. */
  setMe: (me: MeResponse) => void;
  /** 가입 게이트에서 만 14세 미만이라 서버가 계정을 닫았다. 기기를 비우고 로그인으로 보낸다. */
  closeAccountUnder14: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_CHECKING: ProfileState = { status: 'checking', me: null, error: null };

/**
 * 계정이 서버에서 사라진 뒤 이 기기를 비우는 한 벌(auth-session 의 wipeClosedAccount 가 순서를 정한다).
 * 탈퇴, 다른 기기에서 한 탈퇴, 가입 게이트의 만 14세 미만 닫힘이 같이 쓴다.
 */
const CLOSED_ACCOUNT_STEPS: ClosedAccountDependencies = {
  // 서버의 push_tokens 는 서버가 전부 지웠다. 기기의 기록과 알람만 걷는다.
  forgetPushToken,
  cancelReminders,
  wipeLocalData: clearLocalAccountData,
  // 마지막 로그인 제공자 기억은 로그아웃에는 남기지만, 계정이 사라질 때는 지운다.
  forgetLastProvider: () => lastProviderStore.forget(),
  providerLogout: signOutProviders,
  // 서버 로그아웃은 부르지 않는다 — refresh 는 서버가 이미 전부 끊었다.
  clearLocalSession: clearTokens,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [consentEntry, setConsentEntry] = useState<ConsentEntryState>({
    status: 'checking',
    entry: null,
    error: null,
  });
  const [profile, setProfile] = useState<ProfileState>(PROFILE_CHECKING);
  const [signup, setSignup] = useState<PendingSignup | null>(null);
  const [updateRequired, setUpdateRequired] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [consentEntrySession] = useState(() =>
    createConsentEntrySession({
      readEntry: () => api.consentEntry(),
    }),
  );
  const consentLoadGeneration = useRef(0);
  const profileLoadGeneration = useRef(0);

  const loadConsentEntry = useCallback(
    async ({ refresh = false }: { refresh?: boolean } = {}): Promise<ConsentEntryResponse> => {
      const generation = ++consentLoadGeneration.current;
      setConsentEntry({ status: 'checking', entry: null, error: null });
      try {
        const entry = refresh
          ? await consentEntrySession.refresh()
          : await consentEntrySession.readOnce();
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

  const applyMe = useCallback((me: MeResponse) => {
    profileLoadGeneration.current += 1;
    setProfile({ status: profileGateStatus(me), me, error: null });
    // 홈 인사말과 프로필 탭이 읽는 기기 캐시. 정본은 서버의 profile.name이다.
    const name = me.profile?.name?.trim();
    if (me.profile_complete && name) void saveUserName(name).catch(() => undefined);
  }, []);

  const reloadProfile = useCallback(async () => {
    const generation = ++profileLoadGeneration.current;
    setProfile(PROFILE_CHECKING);
    try {
      const me = await api.me();
      if (generation === profileLoadGeneration.current) applyMe(me);
    } catch (error) {
      if (generation === profileLoadGeneration.current) {
        setProfile({ status: 'error', me: null, error });
      }
    }
  }, [applyMe]);

  const resetProfile = useCallback(() => {
    profileLoadGeneration.current += 1;
    setProfile(PROFILE_CHECKING);
  }, []);

  useEffect(() => {
    let active = true;
    loadTokens().then((hasToken) => {
      if (!active) return;
      if (!hasToken) {
        // 로그아웃한 폰에는 리마인드 알람이 없어야 한다. 옛 빌드가 로그인 없이 맞춰 둔 것도 걷는다.
        void cancelReminders().catch(() => undefined);
        setUser(null);
        setStatus('signedOut');
        return;
      }
      setUser(getStoredUser());
      setStatus('signedIn');
      // 갱신 응답에는 동의 목록이 없으므로 앱을 열 때 미결정 동의와 프로필을 직접 읽는다.
      void loadConsentEntry().catch(() => undefined);
      void reloadProfile();
    });
    const unsubTokens = onTokensCleared(() => {
      // 세션이 끊겨 나가는 폰에도 리마인드 알람이 없어야 한다. 진행 중이던 알림 동기화도 여기서 멈춘다.
      void cancelReminders().catch(() => undefined);
      resetConsentEntry();
      resetProfile();
      setUser(null);
      setStatus('signedOut');
    });
    // 403 에 실린 미결정 목록은 요약이다. 화면은 판정 전체(entry)를 다시 읽어 그린다.
    const unsubConsent = onConsentRequired(() => {
      void loadConsentEntry({ refresh: true }).catch(() => undefined);
    });
    const unsubProfile = onProfileRequired(() => {
      void reloadProfile();
    });
    const unsubUpdate = onUpdateRequired(() => setUpdateRequired(true));
    // 다른 기기에서 탈퇴했거나, 탈퇴 후 액세스 토큰이 아직 만료되지 않은 경우.
    // refresh 로 풀 수 없으므로 세션을 끊는다.
    const unsubDeactivated = onAccountDeactivated(() => {
      void wipeClosedAccount(CLOSED_ACCOUNT_STEPS);
    });
    const unsubStoredUser = onStoredUserChanged((nextUser) => {
      resetConsentEntry();
      setUser(nextUser);
      setStatus('signedIn');
      void loadConsentEntry().catch(() => undefined);
      void reloadProfile();
    });
    return () => {
      active = false;
      consentLoadGeneration.current += 1;
      profileLoadGeneration.current += 1;
      unsubTokens();
      unsubConsent();
      unsubProfile();
      unsubUpdate();
      unsubDeactivated();
      unsubStoredUser();
    };
  }, [loadConsentEntry, reloadProfile, resetConsentEntry, resetProfile]);

  // 푸시 토큰 등록은 보호 기능이다. 동의와 프로필이 끝난 뒤에만 서버가 받으므로, 게이트를
  // 통과한 순간과 (게이트가 이미 끝난 회원은) 앱을 열 때 등록한다. 서버의 알림 토글을 읽어
  // 저녁 리마인드 30일치도 함께 맞춘다. 최선 노력이라 기다리지 않는다.
  const gatePassed =
    status === 'signedIn' && consentEntry.status === 'allowed' && profile.status === 'complete';
  useEffect(() => {
    if (gatePassed) void syncNotificationsAfterGate().catch(() => undefined);
  }, [gatePassed, user?.id]);

  // 1.0.0 이전 앱이 기기에 남긴 대본은 게이트를 지난 뒤 한 번 서버로 옮긴다(reading.script). 보호 기능이라
  // 그 전에는 서버가 받지 않는다. 실패한 대본은 기기에 남아 다음 실행에 다시 한다. 기다리지 않는다.
  useEffect(() => {
    if (gatePassed) void runLegacyScriptMigrationOnce();
  }, [gatePassed]);

  // "앱을 열 때"는 새로 켤 때만이 아니다. 배경에서 돌아올 때도 밀린 토큰 삭제를 다시 보내고,
  // 게이트를 통과한 계정이면 알림 설정·토큰 등록·리마인드 30일치를 다시 맞춘다. 다른 기기에서
  // 푸시 토글 둘을 껐다 켜면 이 폰의 토큰도 지워져 있다. 너무 잦지 않게 최소 간격을 둔다
  // (notification-sync).
  const gatePassedRef = useRef(gatePassed);
  gatePassedRef.current = gatePassed;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void syncNotificationsOnForeground(gatePassedRef.current).catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const finishLogin = useCallback(
    async (pair: TokenPair, provider: LoginProvider, providerName: string | null) => {
      const committed = await setTokens(
        pair.access_token,
        pair.refresh_token,
        pair.user,
      );
      if (!committed) return;
      // 제공자가 준 이름은 저장하지 않는다. 프로필 화면의 이름 칸을 미리 채우는 데만 쓴다.
      setProviderNameHint(providerName);
      void lastProviderStore.remember(provider);
      resetConsentEntry();
      setSignup(null);
      setLoginNotice(null);
      setUser(pair.user);
      setStatus('signedIn');
      void loadConsentEntry().catch(() => undefined);
      void reloadProfile();
    },
    [loadConsentEntry, reloadProfile, resetConsentEntry],
  );

  const signInWith = useCallback(
    async (provider: LoginProvider) => {
      const credential = await providerAdapter(provider).signIn();
      if (!credential) return; // 사용자가 취소
      const response = await api.login(loginRequestBody(credential));
      const outcome = resolveLoginOutcome(response, {
        provider,
        displayName: credential.displayName ?? null,
        now: Date.now(),
      });
      if (outcome.kind === 'signed_in') {
        await finishLogin(outcome.pair, provider, credential.displayName ?? null);
        return;
      }
      // 처음 온 신원. 서버에는 아직 아무 행도 없고 앱은 가입 토큰만 들고 동의 화면으로 간다.
      setLoginNotice(null);
      setSignup(outcome.signup);
    },
    [finishLogin],
  );

  const cancelSignup = useCallback((notice?: string) => {
    // 동의 화면에서 나가면 제공자가 준 이름도 함께 사라진다(애플은 다시 주지 않는다).
    setProviderNameHint(null);
    setSignup(null);
    setLoginNotice(notice ?? null);
  }, []);

  const submitSignup = useCallback(
    async (choices: ReadonlyMap<string, ConsentChoice>) => {
      if (!signup) return;
      if (isSignupExpired(signup, Date.now())) {
        cancelSignup(t('login.signupExpired'));
        return;
      }
      const pair = await api.signup(
        signup.signupToken,
        buildSignupDecisions(signup.documents, choices),
      );
      await finishLogin(pair, signup.provider, signup.displayName);
    },
    [cancelSignup, finishLogin, signup],
  );

  const reloadSignupDocuments = useCallback(async () => {
    const { documents } = await api.consentDocuments();
    setSignup((current) => (current ? { ...current, documents } : current));
  }, []);

  const saveProfile = useCallback(
    async (payload: ProfilePayload) => {
      const me = await api.saveProfile(payload);
      applyMe(me);
      return me;
    },
    [applyMe],
  );

  const closeAccountUnder14 = useCallback(async () => {
    // 서버가 계정을 행째 지웠고 토큰도 죽었다. 기기의 계정 자료를 지우고 로그인으로 보낸다.
    setLoginNotice(t('profileName.under14Closed'));
    await wipeClosedAccount(CLOSED_ACCOUNT_STEPS);
  }, []);

  const signOut = useCallback(async () => {
    const rt = getRefreshToken();
    // 순서가 계약이다: 푸시 토큰 삭제 → 리프레시 폐기 → 제공자 세션 정리 → 기기 토큰 삭제.
    // 앞이 실패해도 뒤는 간다 — 비행기 모드에서도 로그아웃된다(auth-session).
    await signOutBestEffort({
      // 로그아웃 뒤에 오는 알림은 다음 사용자의 화면에 뜬다. 지우지 못하면 기기에 적어 두었다가
      // 다음 실행 때 로그인 없이 다시 보낸다.
      deletePushToken: detachPushToken,
      serverLogout: async () => {
        if (rt) await api.logout(rt);
      },
      providerLogout: signOutProviders,
      cancelReminders,
      // 토큰과 계정 캐시(이름, 동의 상태)를 지운다. 마지막 로그인 제공자 기억은 남긴다.
      clearLocalSession: async () => {
        await clearAccountCache().catch(() => undefined);
        await clearTokens();
      },
    });
    setUser(null);
    setStatus('signedOut');
  }, []);

  const deleteAccount = useCallback(async () => {
    // 서버가 먼저다. api.deleteMe() 가 실패하면(네트워크·서버 오류) 기기를 건드리지 않고 예외를
    // 올린다 — 계정은 살아 있는데 기기에서만 로그아웃되면 탈퇴한 줄 알고 떠난다. 다시 눌러도
    // 안전하다(서버 처리가 멱등). 성공한 뒤에는 실패해도 계속 간다(auth-session).
    await withdrawAccount({
      // 구글은 서버가 ID 토큰만 받아 끊을 수단이 없어 앱이 탈퇴 요청 직전에 SDK 로 끊는다.
      // 애플·카카오·네이버는 서버가 끊는다.
      disconnectProviders,
      serverWithdraw: async () => {
        await api.deleteMe();
      },
      ...CLOSED_ACCOUNT_STEPS,
    });
    setUser(null);
    setStatus('signedOut');
  }, []);

  const clearLoginNotice = useCallback(() => setLoginNotice(null), []);

  const value = useMemo(
    () => ({
      status,
      user,
      consentEntry,
      profile,
      signup,
      updateRequired,
      loginNotice,
      clearLoginNotice,
      signInWith,
      submitSignup,
      reloadSignupDocuments,
      cancelSignup,
      signOut,
      deleteAccount,
      refreshConsentEntry,
      reloadProfile,
      saveProfile,
      setMe: applyMe,
      closeAccountUnder14,
    }),
    [
      status,
      user,
      consentEntry,
      profile,
      signup,
      updateRequired,
      loginNotice,
      clearLoginNotice,
      signInWith,
      submitSignup,
      reloadSignupDocuments,
      cancelSignup,
      signOut,
      deleteAccount,
      refreshConsentEntry,
      reloadProfile,
      saveProfile,
      applyMe,
      closeAccountUnder14,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

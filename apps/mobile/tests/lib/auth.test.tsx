import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { AuthProvider, useAuth } from '@/lib/auth';
import { setAnalyticsUserId } from '@/lib/analytics';
import { flushPracticeFeedback } from '@/lib/exit-review';
import { lastProviderStore } from '@/lib/last-provider';
import { flushLibraryUploads } from '@/lib/library/library-runner';
import { clearAccountCache, clearLocalAccountData } from '@/lib/local-account-data';
import { flushNoteRatings } from '@/lib/note-rating';
import {
  cancelReminders,
  detachPushToken,
  forgetPushToken,
  syncNotificationsAfterGate,
  syncNotificationsOnForeground,
} from '@/lib/notifications';
import { saveUserName, setProviderNameHint } from '@/lib/profile';
import { disconnectProviders, providerAdapter, signOutProviders } from '@/lib/provider-sdk';
import { flushReadingRatings } from '@/lib/reading-rating';
import { runLegacyScriptMigrationOnce } from '@/lib/reading/legacy-migration-runner';
import { flushRecordingUploads } from '@/lib/reading/recording-runner';
import { identifySignupAttributionAccount } from '@/lib/signup-attribution-runtime';

jest.mock('@/lib/api', () => ({
  api: {
    consentEntry: jest.fn(),
    me: jest.fn(),
    login: jest.fn(),
    signup: jest.fn(),
    consentDocuments: jest.fn(),
    saveProfile: jest.fn(),
    logout: jest.fn(),
    deleteMe: jest.fn(),
  },
}));

// 기기 저장소 대신 메모리에 토큰을 두고, 서버 응답이 일으키는 알림을 시험에서 직접 보낸다.
jest.mock('@/lib/token-store', () => {
  const listeners: Record<string, Set<(arg?: unknown) => void>> = {
    cleared: new Set(),
    consent: new Set(),
    profile: new Set(),
    update: new Set(),
    deactivated: new Set(),
    user: new Set(),
  };
  const state: { access: string | null; refresh: string | null; user: unknown; commit: boolean } = {
    access: null,
    refresh: null,
    user: null,
    commit: true,
  };
  const subscribe = <T,>(set: Set<T>) => (fn: T) => {
    set.add(fn);
    return () => set.delete(fn);
  };
  return {
    mockTokenState: state,
    mockTokenListeners: listeners,
    loadTokens: jest.fn(async () => state.access !== null),
    getRefreshToken: () => state.refresh,
    getStoredUser: () => state.user,
    setTokens: jest.fn(async (access: string, refresh: string, user: unknown) => {
      if (!state.commit) return false;
      Object.assign(state, { access, refresh, user });
      return true;
    }),
    clearTokens: jest.fn(async () => {
      Object.assign(state, { access: null, refresh: null, user: null });
      for (const fn of listeners.cleared) fn();
    }),
    onTokensCleared: subscribe(listeners.cleared),
    onConsentRequired: subscribe(listeners.consent),
    onProfileRequired: subscribe(listeners.profile),
    onUpdateRequired: subscribe(listeners.update),
    onAccountDeactivated: subscribe(listeners.deactivated),
    onStoredUserChanged: subscribe(listeners.user),
  };
});

jest.mock('@/lib/notifications', () => ({
  cancelReminders: jest.fn(async () => undefined),
  detachPushToken: jest.fn(async () => undefined),
  forgetPushToken: jest.fn(async () => undefined),
  syncNotificationsAfterGate: jest.fn(async () => undefined),
  syncNotificationsOnForeground: jest.fn(async () => undefined),
}));
jest.mock('@/lib/provider-sdk', () => ({
  providerAdapter: jest.fn(),
  signOutProviders: jest.fn(async () => undefined),
  disconnectProviders: jest.fn(async () => undefined),
}));
jest.mock('@/lib/signup-attribution-runtime', () => ({ identifySignupAttributionAccount: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ setAnalyticsUserId: jest.fn(async () => undefined) }));
jest.mock('@/lib/profile', () => ({
  saveUserName: jest.fn(async () => undefined),
  setProviderNameHint: jest.fn(),
}));
jest.mock('@/lib/local-account-data', () => ({
  clearAccountCache: jest.fn(async () => undefined),
  clearLocalAccountData: jest.fn(async () => undefined),
}));
jest.mock('@/lib/last-provider', () => ({
  lastProviderStore: { remember: jest.fn(async () => undefined), forget: jest.fn(async () => undefined) },
}));
jest.mock('@/lib/reading/legacy-migration-runner', () => ({ runLegacyScriptMigrationOnce: jest.fn(async () => undefined) }));
jest.mock('@/lib/exit-review', () => ({ flushPracticeFeedback: jest.fn(async () => undefined) }));
jest.mock('@/lib/note-rating', () => ({ flushNoteRatings: jest.fn(async () => undefined) }));
jest.mock('@/lib/reading-rating', () => ({ flushReadingRatings: jest.fn(async () => undefined) }));
jest.mock('@/lib/library/library-runner', () => ({ flushLibraryUploads: jest.fn(async () => undefined) }));
jest.mock('@/lib/reading/recording-runner', () => ({ flushRecordingUploads: jest.fn(async () => undefined) }));

const { mockTokenState: tokens, mockTokenListeners: listeners } = jest.requireMock('@/lib/token-store');
const apiMock = api as unknown as Record<string, jest.Mock>;

const USER = { id: 'user-1', email: 'a@b.c', status: 'active' as const };
const allowedEntry = { entry_status: 'allowed', documents: [], pending: [] };
const completeMe = {
  id: 'member-1',
  account_type: 'member',
  profile_complete: true,
  profile: { name: '  민지 ' },
};
const doc = (id: string, type: string, required: boolean) => ({ id, type, required, title: type, version: 1 });

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return (
    <>
      <Text>{`status:${auth.status}`}</Text>
      <Text>{`user:${auth.user?.id ?? '-'}`}</Text>
      <Text>{`consent:${auth.consentEntry.status}`}</Text>
      <Text>{`profile:${auth.profile.status}:${auth.profile.me?.id ?? '-'}`}</Text>
      <Text>{`signup:${auth.signup ? `${auth.signup.provider}/${auth.signup.documents.map(d => d.id).join(',')}` : '-'}`}</Text>
      <Text>{`update:${auth.updateRequired}`}</Text>
      <Text>{`notice:${auth.loginNotice ? JSON.stringify(auth.loginNotice) : '-'}`}</Text>
    </>
  );
}

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
const show = async () => {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await flush();
};
const seen = (text: string) => expect(screen.getByText(text)).toBeOnTheScreen();

let appStateHandler: ((next: string) => void) | null;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(tokens, { access: null, refresh: null, user: null, commit: true });
  apiMock.consentEntry.mockResolvedValue(allowedEntry);
  apiMock.me.mockResolvedValue(completeMe);
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (next: string) => void) => {
    appStateHandler = handler;
    return { remove: () => { appStateHandler = null; } };
  }) as never);
});

test('저장된 토큰이 없으면 로그아웃 상태가 되고 남은 리마인드를 걷는다', async () => {
  await show();
  seen('status:signedOut');
  seen('user:-');
  expect(cancelReminders).toHaveBeenCalledTimes(1);
  expect(apiMock.consentEntry).not.toHaveBeenCalled();
});

test('저장된 세션이면 동의 판정과 프로필을 읽고, 게이트를 지나면 밀린 일을 보낸다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  await show();

  seen('status:signedIn');
  seen('user:user-1');
  seen('consent:allowed');
  seen('profile:complete:member-1');
  expect(saveUserName).toHaveBeenCalledWith('민지');
  expect(identifySignupAttributionAccount).toHaveBeenLastCalledWith('member-1');
  expect(setAnalyticsUserId).toHaveBeenLastCalledWith('member-1');
  expect(syncNotificationsAfterGate).toHaveBeenCalledTimes(1);
  expect(runLegacyScriptMigrationOnce).toHaveBeenCalledTimes(1);
  expect(flushRecordingUploads).toHaveBeenCalledTimes(1);
  expect(flushPracticeFeedback).toHaveBeenCalledTimes(1);
  expect(flushNoteRatings).toHaveBeenCalledTimes(1);
  expect(flushReadingRatings).toHaveBeenCalledTimes(1);
  expect(flushLibraryUploads).toHaveBeenCalledWith('user-1');
});

test('프로필이 덜 찼거나 게스트면 이름을 저장하지 않고 계정 연결도 하지 않는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  apiMock.me.mockResolvedValue({ id: 'guest-1', account_type: 'guest', profile_complete: false, profile: null });
  await show();

  seen('profile:required:guest-1');
  expect(saveUserName).not.toHaveBeenCalled();
  expect(identifySignupAttributionAccount).toHaveBeenLastCalledWith(null);
  expect(setAnalyticsUserId).toHaveBeenLastCalledWith(null);
  expect(syncNotificationsAfterGate).not.toHaveBeenCalled();
});

test('동의 판정·프로필 읽기가 실패하면 오류 상태로 남는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  apiMock.consentEntry.mockRejectedValue(new Error('down'));
  apiMock.me.mockRejectedValue(new Error('down'));
  await show();

  seen('consent:error');
  seen('profile:error:-');
});

test('이미 있는 계정으로 로그인하면 토큰을 저장하고 로그인 상태가 된다', async () => {
  (providerAdapter as jest.Mock).mockReturnValue({
    signIn: async () => ({ provider: 'google', idToken: 'id-token', displayName: '구글이름' }),
  });
  apiMock.login.mockResolvedValue({ result: 'signed_in', access_token: 'a', refresh_token: 'r', user: USER });
  await show();

  await act(() => auth.signInWith('google'));
  await flush();

  expect(apiMock.login).toHaveBeenCalledWith({ provider: 'google', id_token: 'id-token' });
  expect(tokens).toMatchObject({ access: 'a', refresh: 'r', user: USER });
  expect(setProviderNameHint).toHaveBeenCalledWith('구글이름');
  expect(lastProviderStore.remember).toHaveBeenCalledWith('google');
  seen('status:signedIn');
  seen('user:user-1');
  seen('consent:allowed');
  seen('profile:complete:member-1');
});

test('토큰 저장이 다른 로그인에 밀리면 로그인 상태로 바꾸지 않는다', async () => {
  tokens.commit = false;
  (providerAdapter as jest.Mock).mockReturnValue({
    signIn: async () => ({ provider: 'kakao', idToken: 'id' }),
  });
  apiMock.login.mockResolvedValue({ result: 'signed_in', access_token: 'a', refresh_token: 'r', user: USER });
  await show();

  await act(() => auth.signInWith('kakao'));

  seen('status:signedOut');
  expect(lastProviderStore.remember).not.toHaveBeenCalled();
});

test('제공자 로그인을 취소하면 서버에 보내지 않는다', async () => {
  (providerAdapter as jest.Mock).mockReturnValue({ signIn: async () => null });
  await show();

  await act(() => auth.signInWith('apple'));

  expect(apiMock.login).not.toHaveBeenCalled();
  seen('status:signedOut');
});

test('이메일 겹침 409는 던지지 않고 로그인 안내로 남기며, 지우면 사라진다', async () => {
  (providerAdapter as jest.Mock).mockReturnValue({ signIn: async () => ({ provider: 'google', idToken: 'id' }) });
  apiMock.login.mockRejectedValue(
    new ApiError(409, 'conflict', 'account_exists_with_different_provider', undefined, {
      code: 'account_exists_with_different_provider',
      providers: ['kakao', 'naver'],
    }),
  );
  await show();

  await act(() => auth.signInWith('google'));
  seen('notice:{"kind":"email_conflict","provider":"kakao"}');

  await act(async () => auth.clearLoginNotice());
  seen('notice:-');
});

test('겹침이 아닌 로그인 실패는 그대로 던진다', async () => {
  (providerAdapter as jest.Mock).mockReturnValue({ signIn: async () => ({ provider: 'google', idToken: 'id' }) });
  apiMock.login.mockRejectedValue(new ApiError(500, 'boom'));
  await show();

  await expect(act(() => auth.signInWith('google'))).rejects.toThrow('boom');
  seen('status:signedOut');
});

describe('처음 온 신원의 가입', () => {
  const documents = [doc('terms', 'terms', true), doc('mkt', 'marketing_email', false)];
  const startSignup = async (expiresIn = 600) => {
    (providerAdapter as jest.Mock).mockReturnValue({
      signIn: async () => ({ provider: 'apple', idToken: 'id', authorizationCode: 'code', displayName: '애플이름' }),
    });
    apiMock.login.mockResolvedValue({
      result: 'signup_required',
      signup_token: 'signup-token',
      expires_in: expiresIn,
      documents,
    });
    await show();
    await act(() => auth.signInWith('apple'));
  };

  test('동의 화면으로 가고, 동의하고 계속하면 계정이 생겨 로그인된다', async () => {
    await startSignup();
    seen('signup:apple/terms,mkt');
    seen('status:signedOut');
    expect(apiMock.login).toHaveBeenCalledWith({ provider: 'apple', id_token: 'id', authorization_code: 'code' });

    apiMock.signup.mockResolvedValue({ access_token: 'a2', refresh_token: 'r2', user: USER });
    let created = false;
    await act(async () => {
      created = await auth.submitSignup(new Map([['terms', 'granted'], ['mkt', 'declined']]));
    });
    await flush();

    expect(created).toBe(true);
    expect(apiMock.signup).toHaveBeenCalledWith('signup-token', [
      { document_id: 'terms', action: 'granted' },
      { document_id: 'mkt', action: 'declined' },
    ]);
    expect(setProviderNameHint).toHaveBeenLastCalledWith('애플이름');
    expect(lastProviderStore.remember).toHaveBeenCalledWith('apple');
    seen('signup:-');
    seen('status:signedIn');
  });

  test('보는 사이 새 판이 나오면 문서를 다시 받아 바꾼다', async () => {
    await startSignup();
    apiMock.consentDocuments.mockResolvedValue({ documents: [doc('terms-v2', 'terms', true)] });

    await act(() => auth.reloadSignupDocuments());

    seen('signup:apple/terms-v2');
  });

  test('가입 토큰이 만료됐으면 제출하지 않고 로그인 화면으로 돌아간다', async () => {
    await startSignup(0);
    let created = true;
    await act(async () => {
      created = await auth.submitSignup(new Map());
    });

    expect(created).toBe(false);
    expect(apiMock.signup).not.toHaveBeenCalled();
    expect(setProviderNameHint).toHaveBeenLastCalledWith(null);
    seen('signup:-');
    seen('notice:-');
  });

  test('제출 중 이메일 겹침이면 안내와 함께 로그인부터 다시 시작한다', async () => {
    await startSignup();
    apiMock.signup.mockRejectedValue(
      new ApiError(409, 'conflict', 'account_exists_with_different_provider', undefined, { providers: ['google'] }),
    );
    let created = true;
    await act(async () => {
      created = await auth.submitSignup(new Map([['terms', 'granted']]));
    });

    expect(created).toBe(false);
    seen('signup:-');
    seen('notice:{"kind":"email_conflict","provider":"google"}');
  });

  test('가입 토큰이 서버에서 거절되면 안내 없이 로그인부터 다시 시작한다', async () => {
    await startSignup();
    apiMock.signup.mockRejectedValue(new ApiError(401, 'bad', 'invalid_signup_token'));
    let created = true;
    await act(async () => {
      created = await auth.submitSignup(new Map([['terms', 'granted']]));
    });

    expect(created).toBe(false);
    seen('signup:-');
    seen('notice:-');
  });

  test('다시 시도할 수 있는 제출 실패는 던지고 동의 화면에 남는다', async () => {
    await startSignup();
    apiMock.signup.mockRejectedValue(new ApiError(500, 'server down'));

    await expect(act(() => auth.submitSignup(new Map([['terms', 'granted']])))).rejects.toThrow('server down');
    seen('signup:apple/terms,mkt');
  });

  test('동의 화면에서 나가면 가입 정보를 버리고 받은 안내를 남긴다', async () => {
    await startSignup();
    await act(async () => auth.cancelSignup({ kind: 'notice', message: '안내' }));

    seen('signup:-');
    seen('notice:{"kind":"notice","message":"안내"}');
    expect(setProviderNameHint).toHaveBeenLastCalledWith(null);
  });
});

test('가입 중이 아니면 제출과 문서 다시 받기는 가입 상태를 만들지 않는다', async () => {
  await show();
  apiMock.consentDocuments.mockResolvedValue({ documents: [doc('terms', 'terms', true)] });
  await act(() => auth.reloadSignupDocuments());
  seen('signup:-');

  let created = true;
  await act(async () => {
    created = await auth.submitSignup(new Map());
  });
  expect(created).toBe(false);
  expect(apiMock.signup).not.toHaveBeenCalled();
});

test('로그아웃은 서버 리프레시를 폐기하고 기기 세션을 지운다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'refresh-1', user: USER });
  apiMock.logout.mockRejectedValue(new Error('offline'));
  await show();

  await act(() => auth.signOut());

  expect(detachPushToken).toHaveBeenCalledTimes(1);
  expect(apiMock.logout).toHaveBeenCalledWith('refresh-1');
  expect(signOutProviders).toHaveBeenCalledTimes(1);
  expect(clearAccountCache).toHaveBeenCalledTimes(1);
  expect(tokens).toMatchObject({ access: null, refresh: null });
  expect(lastProviderStore.forget).not.toHaveBeenCalled();
  expect(identifySignupAttributionAccount).toHaveBeenLastCalledWith(null);
  seen('status:signedOut');
  seen('user:-');
  seen('consent:checking');
  seen('profile:checking:-');
});

test('리프레시 토큰이 없으면 서버 로그아웃을 부르지 않는다', async () => {
  await show();
  await act(() => auth.signOut());
  expect(apiMock.logout).not.toHaveBeenCalled();
  seen('status:signedOut');
});

test('탈퇴는 서버 파기 뒤 기기 자료와 마지막 제공자 기억까지 지운다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  apiMock.deleteMe.mockResolvedValue(undefined);
  await show();

  await act(() => auth.deleteAccount());

  expect(disconnectProviders).toHaveBeenCalledTimes(1);
  expect(apiMock.deleteMe).toHaveBeenCalledTimes(1);
  expect(forgetPushToken).toHaveBeenCalledTimes(1);
  expect(clearLocalAccountData).toHaveBeenCalledTimes(1);
  expect(lastProviderStore.forget).toHaveBeenCalledTimes(1);
  expect(tokens.access).toBeNull();
  expect(setAnalyticsUserId).toHaveBeenLastCalledWith(null);
  seen('status:signedOut');
});

test('탈퇴 요청이 실패하면 기기를 건드리지 않고 로그인 상태로 남는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  apiMock.deleteMe.mockRejectedValue(new Error('network'));
  await show();

  await expect(act(() => auth.deleteAccount())).rejects.toThrow('network');

  expect(clearLocalAccountData).not.toHaveBeenCalled();
  expect(tokens.access).toBe('a');
  seen('status:signedIn');
});

test('만 14세 미만으로 닫히면 기기를 비우고 회색 상자 안내를 남긴다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  await show();

  await act(() => auth.closeAccountUnder14());

  expect(clearLocalAccountData).toHaveBeenCalledTimes(1);
  expect(lastProviderStore.forget).toHaveBeenCalledTimes(1);
  seen('status:signedOut');
  seen('notice:{"kind":"notice","message":"만 14세 미만은 가입할 수 없어요. 입력한 정보와 계정은 바로 지웠어요."}');
});

test('프로필 저장과 서버가 돌려준 내 계정 반영은 프로필 상태를 바꾼다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  apiMock.me.mockResolvedValue({ id: 'm', account_type: 'member', profile_complete: false, profile: null });
  await show();
  seen('profile:required:m');

  const saved = { id: 'm', account_type: 'member', profile_complete: true, profile: { name: '하늘' } };
  apiMock.saveProfile.mockResolvedValue(saved);
  let returned: unknown;
  await act(async () => {
    returned = await auth.saveProfile({ name: '하늘' } as never);
  });
  expect(returned).toEqual(saved);
  expect(saveUserName).toHaveBeenCalledWith('하늘');
  seen('profile:complete:m');

  await act(async () => auth.setMe({ id: 'm2', account_type: 'member', profile_complete: true, profile: { name: ' ' } } as never));
  seen('profile:complete:m2');
  expect(saveUserName).toHaveBeenCalledTimes(1);
});

test('동의 판정을 다시 읽으면 캐시를 건너뛰고 새 판정을 쓴다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  await show();
  apiMock.consentEntry.mockResolvedValue({ entry_status: 'decision_required', documents: [], pending: [] });

  let entry: unknown;
  await act(async () => {
    entry = await auth.refreshConsentEntry();
  });

  expect(entry).toEqual({ entry_status: 'decision_required', documents: [], pending: [] });
  seen('consent:decision_required');
});

test('늦게 끝난 옛 동의 읽기는 새 결과를 덮지 않는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  let resolveFirst!: (value: unknown) => void;
  apiMock.consentEntry.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  await show();
  seen('consent:checking');

  apiMock.consentEntry.mockResolvedValue({ entry_status: 'decision_required', documents: [], pending: [] });
  await act(async () => { await auth.refreshConsentEntry(); });
  seen('consent:decision_required');

  await act(async () => { resolveFirst(allowedEntry); });
  await flush();
  seen('consent:decision_required');
});

test('늦게 끝난 옛 동의·프로필 실패는 새 상태를 덮지 않는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  let rejectConsent!: (error: unknown) => void;
  let rejectMe!: (error: unknown) => void;
  apiMock.consentEntry.mockImplementationOnce(() => new Promise((_, reject) => { rejectConsent = reject; }));
  apiMock.me.mockImplementationOnce(() => new Promise((_, reject) => { rejectMe = reject; }));
  await show();

  await act(async () => { await auth.refreshConsentEntry(); await auth.reloadProfile(); });
  seen('consent:allowed');
  seen('profile:complete:member-1');

  await act(async () => { rejectConsent(new Error('late')); rejectMe(new Error('late')); });
  await flush();
  seen('consent:allowed');
  seen('profile:complete:member-1');
});

test('늦게 끝난 옛 프로필 읽기는 새 프로필을 덮지 않는다', async () => {
  Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
  let resolveMe!: (value: unknown) => void;
  apiMock.me.mockImplementationOnce(() => new Promise(resolve => { resolveMe = resolve; }));
  await show();

  apiMock.me.mockResolvedValue({ id: 'newer', account_type: 'member', profile_complete: true, profile: null });
  await act(() => auth.reloadProfile());
  seen('profile:complete:newer');

  await act(async () => { resolveMe(completeMe); });
  await flush();
  seen('profile:complete:newer');
});

describe('서버 응답이 보내는 알림', () => {
  beforeEach(async () => {
    Object.assign(tokens, { access: 'a', refresh: 'r', user: USER });
    await show();
  });

  test('세션이 끊기면 로그아웃 상태로 돌아가고 리마인드를 걷는다', async () => {
    (cancelReminders as jest.Mock).mockClear();
    await act(async () => { for (const fn of listeners.cleared) fn(); });
    seen('status:signedOut');
    seen('consent:checking');
    seen('profile:checking:-');
    expect(cancelReminders).toHaveBeenCalledTimes(1);
  });

  test('동의가 필요하다는 403이면 판정 전체를 다시 읽는다', async () => {
    apiMock.consentEntry.mockResolvedValue({ entry_status: 'decision_required', documents: [], pending: [] });
    await act(async () => { for (const fn of listeners.consent) fn([]); });
    await flush();
    seen('consent:decision_required');
  });

  test('프로필이 필요하다는 403이면 프로필을 다시 읽는다', async () => {
    apiMock.me.mockResolvedValue({ id: 'm3', account_type: 'member', profile_complete: false, profile: null });
    await act(async () => { for (const fn of listeners.profile) fn(); });
    await flush();
    seen('profile:required:m3');
  });

  test('426이면 업데이트 안내 상태가 된다', async () => {
    seen('update:false');
    await act(async () => { for (const fn of listeners.update) fn(); });
    seen('update:true');
  });

  test('다른 기기에서 탈퇴했으면 기기를 비우고 로그아웃한다', async () => {
    await act(async () => { for (const fn of listeners.deactivated) fn(); });
    await flush();
    expect(forgetPushToken).toHaveBeenCalledTimes(1);
    expect(clearLocalAccountData).toHaveBeenCalledTimes(1);
    seen('status:signedOut');
  });

  test('저장된 사용자가 교정되면 새 사용자로 다시 읽는다', async () => {
    await act(async () => { for (const fn of listeners.user) fn({ ...USER, id: 'user-2' }); });
    await flush();
    seen('user:user-2');
    seen('status:signedIn');
    expect(apiMock.me).toHaveBeenCalledTimes(2);
  });

  test('앱이 앞으로 돌아오면 게이트 통과 여부를 들고 알림을 다시 맞춘다', async () => {
    await act(async () => { appStateHandler?.('background'); appStateHandler?.('active'); });
    expect(syncNotificationsOnForeground).toHaveBeenCalledTimes(1);
    expect(syncNotificationsOnForeground).toHaveBeenCalledWith(true);
  });
});

test('화면이 내려간 뒤 끝난 토큰 읽기는 상태를 바꾸지 않는다', async () => {
  let resolveLoad!: (value: boolean) => void;
  const tokenStore = jest.requireMock('@/lib/token-store');
  tokenStore.loadTokens.mockImplementationOnce(() => new Promise(resolve => { resolveLoad = resolve; }));
  const view = await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  seen('status:loading');
  await view.unmount();
  await act(async () => { resolveLoad(false); });
  expect(cancelReminders).not.toHaveBeenCalled();
  expect(listeners.cleared.size).toBe(0);
});

test('AuthProvider 밖에서 useAuth를 부르면 알려 준다', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(render(<Probe />)).rejects.toThrow('useAuth must be used within AuthProvider');
});

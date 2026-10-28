import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import ConsentHistoryScreen from '@/app/consent-history';
import NotificationOffScreen from '@/app/notification-off';
import NotificationSettingsScreen from '@/app/notification-settings';
import SettingsScreen from '@/app/settings';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { loadNotificationSettings, openNotificationPermissionSettings, setNotificationToggle } from '@/lib/notifications';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/reading/voice-feedback-setting', () => ({ loadVoiceFeedbackEnabled: jest.fn(), saveVoiceFeedbackEnabled: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { consentEntry: jest.fn(), recordConsent: jest.fn(), billingMe: jest.fn(() => Promise.reject(Object.assign(new Error('closed'), { status: 404, code: 'billing_unavailable' }))) } }));
jest.mock('@/lib/store-review', () => ({ openStoreReviewPage: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/i18n', () => ({
  ...jest.requireActual('@/lib/i18n'),
  languagePreference: () => 'system',
  saveLanguagePreference: jest.fn(async () => undefined),
}));
jest.mock('@/lib/notifications', () => ({
  DEFAULT_NOTIFICATION_SETTINGS: { analysis_done: true, challenge: true, evening_reminder: true },
  loadNotificationSettings: jest.fn(),
  openNotificationPermissionSettings: jest.fn(),
  setNotificationToggle: jest.fn(),
}));

const consentEntry = api.consentEntry as jest.Mock;
const recordConsent = api.recordConsent as jest.Mock;
const signOut = jest.fn();
const settings = { analysis_done: true, challenge: false, evening_reminder: true };

function doc(
  id: string,
  type: string,
  title: string,
  required: boolean,
  current_decision: 'granted' | 'declined' | null,
  extra: Partial<ConsentEntryDocument> = {},
): ConsentEntryDocument {
  return {
    id,
    type,
    version: 'v3',
    title,
    body: `${title} 본문`,
    required,
    published_at: '2026-01-01T12:00:00Z',
    current_decision,
    decided_at: current_decision ? '2026-02-01T12:00:00Z' : null,
    ...extra,
  };
}

const docs = [
  doc('d-terms', 'terms', '이용약관', true, 'granted'),
  doc('d-privacy', 'privacy', '개인정보 처리방침', true, 'granted'),
  doc('d-email', 'marketing_email', '광고성 이메일', false, 'declined', { decided_at: null }),
  doc('d-ret', 'post_withdrawal_retention', 'AI 분석 보관', false, null, { published_at: null as never }),
];

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ signOut });
  consentEntry.mockResolvedValue({ entry_status: 'allowed', documents: docs, undecided_documents: [] });
  recordConsent.mockResolvedValue(undefined);
  (loadNotificationSettings as jest.Mock).mockResolvedValue(settings);
  (loadVoiceFeedbackEnabled as jest.Mock).mockResolvedValue(false);
  (saveVoiceFeedbackEnabled as jest.Mock).mockResolvedValue(undefined);
});

// 설정은 pen 「설정 및 활동」(Qs1wj)대로 묶음 목록만 두고, 알림 토글은 「알림」(z3sqdj), 동의 목록은 「동의 내역」(OJWak),
// 권한 꺼짐 안내는 「알림이 꺼져 있어요」(QsOcR) 화면으로 나뉘었다(SOMA-748). 같은 동작을 화면별로 본다.
async function settingsLoaded() {
  await render(<SettingsScreen />);
  await screen.findByText('설정');
}

async function consentLoaded() {
  await render(<ConsentHistoryScreen />);
  await screen.findByText('이용약관');
}

async function notifLoaded() {
  await render(<NotificationSettingsScreen />);
  await screen.findByText('분석 완료');
}

const switches = () => screen.getAllByRole('switch');
/** 선택 문서를 펼쳐 그 자리의 동의 스위치를 꺼낸다. */
async function openOptional(title: string) {
  await fireEvent.press(screen.getByRole('button', { name: title }));
  return () => screen.getByRole('switch', { name: title });
}

describe('동의 내역', () => {
  test('필수를 먼저, 선택은 (선택)을 붙여 내 결정과 날짜와 함께 보여 준다', async () => {
    await consentLoaded();

    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter(Boolean)).toEqual([
      '뒤로',
      '이용약관',
      '개인정보 처리방침',
      '광고성 이메일 (선택)',
      'AI 분석 보관 (선택)',
    ]);
    expect(screen.getAllByText('동의 · 2026.02.01')).toHaveLength(2);
    expect(screen.getByText('거부')).toBeOnTheScreen();
    expect(screen.getByText('아직 결정하지 않음')).toBeOnTheScreen();
    expect(screen.getByText('필수 동의는 내용만 볼 수 있어요. 선택 동의는 눌러서 바꿀 수 있어요.')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
  });

  test('문서를 누르면 판·시행일과 본문을 펼치고 다시 누르면 접는다 — 필수 문서엔 스위치가 없다', async () => {
    await consentLoaded();

    await fireEvent.press(screen.getByRole('button', { name: '이용약관' }));
    expect(screen.getByText('이용약관 본문')).toBeOnTheScreen();
    expect(screen.getByText('판 v3 · 시행 2026.01.01')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '이용약관' }));
    expect(screen.queryByText('이용약관 본문')).not.toBeOnTheScreen();
  });

  test('시행일이 없는 문서는 판만 쓴다', async () => {
    await consentLoaded();
    await openOptional('AI 분석 보관 (선택)');
    expect(screen.getByText('판 v3')).toBeOnTheScreen();
  });

  test('광고성 정보 수신을 바꾸면 저장하고 처리 결과를 알린다', async () => {
    await consentLoaded();
    const sw = await openOptional('광고성 이메일 (선택)');
    expect(sw().props.value).toBe(false);
    consentEntry.mockResolvedValue({
      entry_status: 'allowed',
      documents: docs.map((d) => (d.id === 'd-email' ? { ...d, current_decision: 'granted' as const } : d)),
      undecided_documents: [],
    });

    await fireEvent(sw(), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-email', 'granted');
    expect(await screen.findByText('광고성 정보 수신에 동의했어요')).toBeOnTheScreen();
    // S5.13 토스트 — 「매체 · 보낸 곳 · 처리일」 한 줄과 바꾸는 곳 안내.
    expect(screen.getByText(/^이메일 · Acttub · \d{4}\.\d{2}\.\d{2}$/)).toBeOnTheScreen();
    expect(sw().props.value).toBe(true);
  });

  test('다른 선택 문서는 알림 없이 저장하고 서버의 결정 시각으로 다시 그린다', async () => {
    await consentLoaded();
    const sw = await openOptional('AI 분석 보관 (선택)');
    consentEntry.mockResolvedValue({
      entry_status: 'allowed',
      documents: docs.map((d) => (d.id === 'd-ret' ? { ...d, current_decision: 'granted' as const, decided_at: '2026-10-20T03:00:00Z' } : d)),
      undecided_documents: [],
    });

    await fireEvent(sw(), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-ret', 'granted');
    expect(sw().props.value).toBe(true);
    expect(screen.getByText('동의 · 2026.10.20')).toBeOnTheScreen();
    expect(screen.queryByText('광고성 정보 수신에 동의했어요')).not.toBeOnTheScreen();
  });

  test('저장 뒤 다시 받기가 실패해도 고른 값을 그대로 둔다', async () => {
    await consentLoaded();
    const sw = await openOptional('AI 분석 보관 (선택)');
    consentEntry.mockRejectedValue(new Error('down'));

    await fireEvent(sw(), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-ret', 'granted');
    expect(sw().props.value).toBe(true);
    expect(screen.queryByText('변경 실패')).not.toBeOnTheScreen();
  });

  test('보는 사이 새 판이 나왔으면 다시 받기를 시도하고 알린다', async () => {
    recordConsent.mockRejectedValue(Object.assign(new Error('old'), { code: 'consent_document_outdated' }));
    await consentLoaded();
    const sw = await openOptional('AI 분석 보관 (선택)');
    consentEntry.mockRejectedValueOnce(new Error('down'));

    await fireEvent(sw(), 'valueChange', true);

    expect(await screen.findByText('동의 문서가 새로 바뀌었어요')).toBeOnTheScreen();
    expect(screen.getByText('목록을 다시 불러왔어요. 바뀐 내용을 확인해 주세요.')).toBeOnTheScreen();
    expect(consentEntry).toHaveBeenCalledTimes(2);
  });

  test.each([
    [new Error('서버 점검 중'), '서버 점검 중'],
    ['boom', '잠시 후 다시 시도해주세요.'],
  ])('저장이 실패하면 되돌리고 이유를 알린다 (%#)', async (cause, message) => {
    recordConsent.mockRejectedValue(cause);
    await consentLoaded();
    const sw = await openOptional('광고성 이메일 (선택)');

    await fireEvent(sw(), 'valueChange', true);

    expect(await screen.findByText('변경 실패')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(sw().props.value).toBe(false);
  });

  test('저장하는 동안 다른 선택 동의를 막는다', async () => {
    let finish!: () => void;
    recordConsent.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await consentLoaded();
    const email = await openOptional('광고성 이메일 (선택)');
    const ret = await openOptional('AI 분석 보관 (선택)');

    await fireEvent(email(), 'valueChange', true);
    expect(ret().props.disabled).toBe(true);
    // 저장 중에 다른 스위치를 건드려도 보내지 않는다.
    await fireEvent(ret(), 'valueChange', true);
    expect(recordConsent).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(ret().props.disabled).toBe(false);
  });

  test('못 불러오면 화면 전체 오류와 다시 불러오기를 둔다', async () => {
    consentEntry.mockRejectedValueOnce(new Error('네트워크 오류'));
    await render(<ConsentHistoryScreen />);

    expect(await screen.findByText('동의 내역을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(await screen.findByText('이용약관')).toBeOnTheScreen();
  });

  test('아직 결정하지 않은 필수 문서는 동의로 보이지 않는다', async () => {
    consentEntry.mockResolvedValue({
      entry_status: 'decision_required',
      documents: [doc('d-terms', 'terms', '이용약관', true, null)],
      undecided_documents: [],
    });
    await render(<ConsentHistoryScreen />);

    expect(await screen.findByText('아직 결정하지 않음')).toBeOnTheScreen();
    expect(screen.queryByText(/^동의 · /)).not.toBeOnTheScreen();
  });

  test('문서가 없으면 안내만 둔다', async () => {
    consentEntry.mockResolvedValue({ entry_status: 'allowed', documents: [], undecided_documents: [] });
    await render(<ConsentHistoryScreen />);

    expect(await screen.findByText('필수 동의는 내용만 볼 수 있어요. 선택 동의는 눌러서 바꿀 수 있어요.')).toBeOnTheScreen();
    expect(screen.queryByText(/\(선택\)/)).not.toBeOnTheScreen();
  });

  test('뒤로는 이전 화면으로 간다', async () => {
    await consentLoaded();
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('알림 설정', () => {
  const notifSwitch = (index: number) => switches()[index];

  test('토글 셋을 서버 값으로 그린다', async () => {
    await notifLoaded();

    expect(switches()).toHaveLength(3);
    expect(notifSwitch(0).props.value).toBe(true);
    expect(notifSwitch(1).props.value).toBe(false);
    expect(notifSwitch(2).props.value).toBe(true);
    expect(screen.getByText('좋아요·댓글·마감 소식을 알려 드려요')).toBeOnTheScreen();
  });

  test('바꾸면 서버에 저장한 값으로 그린다', async () => {
    (setNotificationToggle as jest.Mock).mockResolvedValue({ kind: 'saved', settings: { ...settings, challenge: true } });
    await notifLoaded();

    await fireEvent(notifSwitch(1), 'valueChange', true);

    expect(setNotificationToggle).toHaveBeenCalledWith(settings, 'challenge', true);
    expect(notifSwitch(1).props.value).toBe(true);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('OS 권한이 꺼져 있으면 「알림이 꺼져 있어요」로 보내고 저장된 값으로 되돌린다', async () => {
    (setNotificationToggle as jest.Mock).mockResolvedValue({ kind: 'permission_blocked', settings });
    await notifLoaded();

    await fireEvent(notifSwitch(1), 'valueChange', true);

    expect(setNotificationToggle).toHaveBeenCalledWith(settings, 'challenge', true);
    expect(mockRouter.push).toHaveBeenCalledWith('/notification-off');
    expect(notifSwitch(1).props.value).toBe(false);
  });

  test.each([
    [new Error('저장 실패'), '저장 실패'],
    [undefined, '잠시 후 다시 시도해주세요.'],
  ])('실패하면 되돌리고 알린다 (%#)', async (cause, message) => {
    (setNotificationToggle as jest.Mock).mockRejectedValue(cause);
    await notifLoaded();

    await fireEvent(notifSwitch(0), 'valueChange', false);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(notifSwitch(0).props.value).toBe(true);
  });

  test.each([
    [new Error('네트워크 오류'), '네트워크 오류'],
    ['boom', '잠시 후 다시 시도해주세요.'],
  ])('못 불러오면 이유와 다시 불러오기를 둔다 (%#)', async (cause, message) => {
    (loadNotificationSettings as jest.Mock).mockRejectedValueOnce(cause);
    await render(<NotificationSettingsScreen />);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 불러오기'));
    expect(await screen.findByText('분석 완료')).toBeOnTheScreen();
  });
});

describe('알림이 꺼져 있어요', () => {
  test('「설정에서 켜기」는 휴대폰 설정을 열고, 못 열어도 화면을 지킨다', async () => {
    (openNotificationPermissionSettings as jest.Mock).mockRejectedValue(new Error('no settings app'));
    await render(<NotificationOffScreen />);

    expect(screen.getByText('알림 권한이 꺼져 있어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '설정에서 켜기' }));

    expect(openNotificationPermissionSettings).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('「알림 없이 할게요」는 설정을 열지 않고 돌아간다', async () => {
    await render(<NotificationOffScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '알림 없이 할게요' }));

    expect(openNotificationPermissionSettings).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('돌아갈 화면이 없으면 설정으로 간다', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);
    await render(<NotificationOffScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));

    expect(mockRouter.replace).toHaveBeenCalledWith('/settings');
  });
});

describe('설정', () => {
  test('프로필 · 의견 · 기타 묶음으로 두고 보관함·Pro 줄은 없다', async () => {
    await settingsLoaded();

    for (const label of ['프로필', '의견', '기타']) expect(screen.getByText(label)).toBeOnTheScreen();
    // 「코치가 기억하는 것」 줄은 뺐다(10/25) — 기억은 배우에게 보여 주지 않는다.
    for (const gone of ['보관함', /Pro/, '코치가 기억하는 것']) expect(screen.queryByText(gone)).not.toBeOnTheScreen();
    for (const sub of [
      '이름·성별·생년월일·방향·경력·목표와 사진, 한 줄 소개를 고쳐요.',
      '분석 완료·챌린지·저녁 연습 알림을 켜고 꺼요.',
    ]) expect(screen.getByText(sub)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '회원 탈퇴' })).toBeOnTheScreen();
  });

  describe('발음 피드백(실험)', () => {
    test('기기에 저장된 값을 보여 주고 바꾸면 저장한다', async () => {
      (loadVoiceFeedbackEnabled as jest.Mock).mockResolvedValue(true);
      await settingsLoaded();
      await waitFor(() => expect(switches()[0].props.value).toBe(true));

      await fireEvent(switches()[0], 'valueChange', false);
      expect(saveVoiceFeedbackEnabled).toHaveBeenCalledWith(false);
      expect(switches()[0].props.value).toBe(false);
    });

    test('저장이 실패하면 되돌린다', async () => {
      (saveVoiceFeedbackEnabled as jest.Mock).mockRejectedValue(new Error('disk full'));
      await settingsLoaded();

      await fireEvent(switches()[0], 'valueChange', true);
      await waitFor(() => expect(switches()[0].props.value).toBe(false));
    });
  });

  test.each([
    ['프로필 수정', '/profile-edit'],
    ['웹 연습 가져오기', '/guest-transfer'],
    ['알림', '/notification-settings'],
    ['챌린지', '/challenge-entries'],
    ['차단한 사용자', '/blocked-users'],
    ['공지사항', '/notices'],
    ['동의 내역', '/consent-history'],
    ['회원 탈퇴', '/delete-account'],
  ])('%s 줄은 그 화면으로 간다', async (label, path) => {
    await settingsLoaded();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(mockRouter.push).toHaveBeenCalledWith(path);
  });

  test('보관함·가이드 다시 보기 줄은 없다(SOMA-820)', async () => {
    await settingsLoaded();
    expect(screen.queryByRole('button', { name: '보관함' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '가이드 다시 보기' })).not.toBeOnTheScreen();
  });

  test('앱 평가는 스토어 리뷰 화면을 연다', async () => {
    await settingsLoaded();
    await fireEvent.press(screen.getByRole('button', { name: '앱 평가하기' }));
    expect(openStoreReviewPage).toHaveBeenCalledTimes(1);
  });

  test('개발 빌드에서는 UI 미리보기 통로를 둔다', async () => {
    await settingsLoaded();
    await fireEvent.press(screen.getByText('UI 미리보기 (개발용)'));
    expect(mockRouter.push).toHaveBeenCalledWith('/ui-preview');
  });

  describe('문의·신고 메일', () => {
    test('canOpenURL 이 false 여도(안드로이드 11+ 패키지 가시성) 묻지 않고 제목을 채워 연다', async () => {
      const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      await settingsLoaded();

      await fireEvent.press(screen.getByRole('button', { name: '문의·신고 메일 보내기' }));

      await waitFor(() =>
        expect(openURL).toHaveBeenCalledWith(`mailto:acttub0527@gmail.com?subject=${encodeURIComponent('[Acttub] 문의·신고')}`),
      );
      expect(canOpen).not.toHaveBeenCalled();
      expect(screen.queryByText('메일 앱을 열지 못했어요. acttub0527@gmail.com 으로 보내주세요.')).not.toBeOnTheScreen();
    });

    test('받을 메일 앱이 정말 없어 열기가 실패하면 주소를 알려 준다', async () => {
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No Activity found to handle Intent'));
      await settingsLoaded();

      await fireEvent.press(screen.getByRole('button', { name: '문의·신고 메일 보내기' }));

      expect(await screen.findByText('메일 앱을 열지 못했어요. acttub0527@gmail.com 으로 보내주세요.')).toBeOnTheScreen();
    });
  });

  describe('로그아웃', () => {
    test('확인하면 로그아웃한다', async () => {
      await settingsLoaded();
      await fireEvent.press(screen.getByText('로그아웃'));
      expect(await screen.findByText('로그아웃할까요?')).toBeOnTheScreen();
      const labels = screen.getAllByText('로그아웃');
      await fireEvent.press(labels[labels.length - 1]);
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    test('취소하면 그대로 둔다', async () => {
      await settingsLoaded();
      await fireEvent.press(screen.getByText('로그아웃'));
      await fireEvent.press(await screen.findByText('취소'));
      expect(signOut).not.toHaveBeenCalled();
      expect(screen.getByText('로그아웃')).toBeOnTheScreen();
    });
  });

  test('뒤로는 이전 화면으로 간다', async () => {
    await settingsLoaded();
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('언어(SOMA-827 후속)', () => {
  test('프로필 묶음에 언어 줄이 있고, 고르면 저장하고 다시 켜면 바뀐다고 알린다', async () => {
    const { saveLanguagePreference } = jest.requireMock('@/lib/i18n');
    await settingsLoaded();

    expect(screen.getByText('언어')).toBeOnTheScreen();
    expect(screen.getByText('기기 설정 따름')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('언어'));
    expect(screen.getByText('한국어')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('English'));

    expect(saveLanguagePreference).toHaveBeenCalledWith('en');
    // 저장하면 앱 뿌리가 바로 새 언어로 다시 그린다 — 「다시 켜면 바뀐다」 안내는 더 띄우지 않는다(10/28).
    expect(screen.queryByText('앱을 완전히 껐다 켜면 English로 바뀌어요.')).not.toBeOnTheScreen();
  });

  test('지금과 같은 것을 고르면 저장하지 않는다', async () => {
    const { saveLanguagePreference } = jest.requireMock('@/lib/i18n');
    await settingsLoaded();
    await fireEvent.press(screen.getByText('언어'));
    await fireEvent.press(screen.getAllByText('기기 설정 따름').at(-1)!);
    expect(saveLanguagePreference).not.toHaveBeenCalled();
  });
});

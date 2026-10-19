import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import SettingsScreen from '@/app/settings';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { resetSpotlights } from '@/lib/guide-state';
import { loadNotificationSettings, openNotificationPermissionSettings, setNotificationToggle } from '@/lib/notifications';
import { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } from '@/lib/reading/voice-feedback-setting';
import { openStoreReviewPage } from '@/lib/store-review';

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('@/lib/reading/voice-feedback-setting', () => ({ loadVoiceFeedbackEnabled: jest.fn(), saveVoiceFeedbackEnabled: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { consentEntry: jest.fn(), recordConsent: jest.fn() } }));
jest.mock('@/lib/store-review', () => ({ openStoreReviewPage: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/guide-state', () => ({ resetSpotlights: jest.fn() }));
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

async function loaded() {
  await render(<SettingsScreen />);
  await screen.findByText('이용약관');
}

const switches = () => screen.getAllByRole('switch');
const consentSwitch = (index: number) => switches()[1 + index];
const notifSwitch = (index: number) => switches()[switches().length - 3 + index];

test('필수·선택 동의를 판·시행일·내 결정과 함께 보여 준다', async () => {
  await loaded();

  expect(screen.getAllByText('판 v3 · 시행 2026.01.01 · 동의함 2026.02.01')).toHaveLength(2);
  expect(screen.getByText('판 v3 · 시행 2026.01.01 · 거절함')).toBeOnTheScreen();
  expect(screen.getByText('판 v3 · 아직 결정하지 않음')).toBeOnTheScreen();
  expect(screen.getAllByText('동의됨')).toHaveLength(2);
  expect(screen.getByText('필수 동의는 내용만 볼 수 있어요. 동의를 거두려면 회원 탈퇴를 해야 해요.')).toBeOnTheScreen();
  expect(consentSwitch(0).props.value).toBe(false);
  expect(notifSwitch(1).props.value).toBe(false);
  expect(notifSwitch(0).props.value).toBe(true);
});

test('문서를 누르면 본문을 펼치고 다시 누르면 접는다', async () => {
  await loaded();

  await fireEvent.press(screen.getByRole('button', { name: /이용약관/ }));
  expect(screen.getByText('이용약관 본문')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /이용약관/ }));
  expect(screen.queryByText('이용약관 본문')).not.toBeOnTheScreen();
});

describe('선택 동의', () => {
  test('광고성 정보 수신을 바꾸면 저장하고 처리 결과를 알린다', async () => {
    await loaded();
    consentEntry.mockResolvedValue({
      entry_status: 'allowed',
      documents: docs.map((d) => (d.id === 'd-email' ? { ...d, current_decision: 'granted' as const } : d)),
      undecided_documents: [],
    });

    await fireEvent(consentSwitch(0), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-email', 'granted');
    expect(await screen.findByText('광고성 정보 수신 처리 결과')).toBeOnTheScreen();
    expect(screen.getByText(/^Acttub · \d{4}\.\d{2}\.\d{2} 처리 이메일: 수신 동의$/)).toBeOnTheScreen();
    expect(consentSwitch(0).props.value).toBe(true);
  });

  test('다른 선택 문서는 알림 없이 저장하고 서버의 결정 시각으로 다시 그린다', async () => {
    await loaded();
    consentEntry.mockResolvedValue({
      entry_status: 'allowed',
      documents: docs.map((d) => (d.id === 'd-ret' ? { ...d, current_decision: 'granted' as const, decided_at: '2026-10-20T03:00:00Z' } : d)),
      undecided_documents: [],
    });
    await fireEvent(consentSwitch(1), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-ret', 'granted');
    expect(consentSwitch(1).props.value).toBe(true);
    expect(screen.getByText('판 v3 · 동의함 2026.10.20')).toBeOnTheScreen();
    expect(screen.queryByText('광고성 정보 수신 처리 결과')).not.toBeOnTheScreen();
  });

  test('저장 뒤 다시 받기가 실패해도 고른 값을 그대로 둔다', async () => {
    await loaded();
    consentEntry.mockRejectedValue(new Error('down'));

    await fireEvent(consentSwitch(1), 'valueChange', true);

    expect(recordConsent).toHaveBeenCalledWith('d-ret', 'granted');
    expect(consentSwitch(1).props.value).toBe(true);
    expect(screen.queryByText('변경 실패')).not.toBeOnTheScreen();
  });

  test('보는 사이 새 판이 나왔으면 다시 받기를 시도하고 알린다', async () => {
    recordConsent.mockRejectedValue(Object.assign(new Error('old'), { code: 'consent_document_outdated' }));
    await loaded();
    consentEntry.mockRejectedValueOnce(new Error('down'));

    await fireEvent(consentSwitch(1), 'valueChange', true);

    expect(await screen.findByText('동의 문서가 새로 바뀌었어요. 다시 확인해주세요.')).toBeOnTheScreen();
    expect(consentEntry).toHaveBeenCalledTimes(2);
  });

  test.each([
    [new Error('서버 점검 중'), '서버 점검 중'],
    ['boom', '잠시 후 다시 시도해주세요.'],
  ])('저장이 실패하면 되돌리고 이유를 알린다 (%#)', async (cause, message) => {
    recordConsent.mockRejectedValue(cause);
    await loaded();

    await fireEvent(consentSwitch(0), 'valueChange', true);

    expect(await screen.findByText('변경 실패')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(consentSwitch(0).props.value).toBe(false);
  });

  test('저장하는 동안 다른 선택 동의를 막는다', async () => {
    let finish!: () => void;
    recordConsent.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await loaded();

    await fireEvent(consentSwitch(0), 'valueChange', true);
    expect(consentSwitch(1).props.disabled).toBe(true);
    await act(async () => finish());
    expect(consentSwitch(1).props.disabled).toBe(false);
  });
});

describe('알림 토글', () => {
  test('바꾸면 서버에 저장한 값으로 그린다', async () => {
    (setNotificationToggle as jest.Mock).mockResolvedValue({ kind: 'saved', settings: { ...settings, challenge: true } });
    await loaded();

    await fireEvent(notifSwitch(1), 'valueChange', true);

    expect(setNotificationToggle).toHaveBeenCalledWith(settings, 'challenge', true);
    expect(notifSwitch(1).props.value).toBe(true);
  });

  test('OS 권한이 꺼져 있으면 권한 설정으로 안내한다', async () => {
    (setNotificationToggle as jest.Mock).mockResolvedValue({ kind: 'permission_blocked', settings });
    (openNotificationPermissionSettings as jest.Mock).mockRejectedValue(new Error('no settings app'));
    await loaded();

    await fireEvent(notifSwitch(1), 'valueChange', true);
    expect(await screen.findByText('휴대폰 설정에서 Acttub 알림을 허용해야 알림이 와요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('설정 열기'));

    expect(openNotificationPermissionSettings).toHaveBeenCalledTimes(1);
    expect(notifSwitch(1).props.value).toBe(false);
  });

  test('권한 안내를 닫으면 설정을 열지 않는다', async () => {
    (setNotificationToggle as jest.Mock).mockResolvedValue({ kind: 'permission_blocked', settings });
    await loaded();

    await fireEvent(notifSwitch(1), 'valueChange', true);
    await fireEvent.press(await screen.findByText('취소'));
    expect(openNotificationPermissionSettings).not.toHaveBeenCalled();
  });

  test.each([
    [new Error('저장 실패'), '저장 실패'],
    [undefined, '잠시 후 다시 시도해주세요.'],
  ])('실패하면 되돌리고 알린다 (%#)', async (cause, message) => {
    (setNotificationToggle as jest.Mock).mockRejectedValue(cause);
    await loaded();

    await fireEvent(notifSwitch(0), 'valueChange', false);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(notifSwitch(0).props.value).toBe(true);
  });
});

describe('발음 피드백(실험)', () => {
  test('기기에 저장된 값을 보여 주고 바꾸면 저장한다', async () => {
    (loadVoiceFeedbackEnabled as jest.Mock).mockResolvedValue(true);
    await loaded();
    await waitFor(() => expect(switches()[0].props.value).toBe(true));

    await fireEvent(switches()[0], 'valueChange', false);
    expect(saveVoiceFeedbackEnabled).toHaveBeenCalledWith(false);
    expect(switches()[0].props.value).toBe(false);
  });

  test('저장이 실패하면 되돌린다', async () => {
    (saveVoiceFeedbackEnabled as jest.Mock).mockRejectedValue(new Error('disk full'));
    await loaded();

    await fireEvent(switches()[0], 'valueChange', true);
    await waitFor(() => expect(switches()[0].props.value).toBe(false));
  });
});

test.each([
  ['프로필 수정', '/profile-edit'],
  ['웹 연습 가져오기', '/guest-transfer'],
  ['차단한 사용자', '/blocked-users'],
  ['코치가 기억하는 것', '/memory'],
  ['회원 탈퇴', '/delete-account'],
])('%s 칸은 그 화면으로 간다', async (label, path) => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(label) }));
  expect(mockRouter.push).toHaveBeenCalledWith(path);
});

test('가이드 다시 보기는 비추기 안내도 되살리고 가이드를 연다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: /가이드 다시 보기/ }));
  expect(resetSpotlights).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith('/guide');
});

test('앱 평가하기는 스토어 리뷰 화면을 연다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: /앱 평가하기/ }));
  expect(openStoreReviewPage).toHaveBeenCalledTimes(1);
});

test('개발 빌드에서는 UI 미리보기 통로를 둔다', async () => {
  await loaded();
  await fireEvent.press(screen.getByText('UI 미리보기 (개발용)'));
  expect(mockRouter.push).toHaveBeenCalledWith('/ui-preview');
});

describe('문의·신고 메일', () => {
  test('메일 앱을 열 수 있으면 제목을 채워 연다', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await loaded();

    await fireEvent.press(screen.getByRole('button', { name: /문의·신고 메일 보내기/ }));

    expect(openURL).toHaveBeenCalledWith(`mailto:acttub0527@gmail.com?subject=${encodeURIComponent('[Acttub] 문의·신고')}`);
  });

  test('열 수 없으면 주소를 알려 준다', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    await loaded();

    await fireEvent.press(screen.getByRole('button', { name: /문의·신고 메일 보내기/ }));

    expect(await screen.findByText('메일 앱을 열지 못했어요. acttub0527@gmail.com 으로 보내주세요.')).toBeOnTheScreen();
  });
});

describe('로그아웃', () => {
  test('확인하면 로그아웃한다', async () => {
    await loaded();
    await fireEvent.press(screen.getByText('로그아웃'));
    expect(await screen.findByText('로그아웃할까요?')).toBeOnTheScreen();
    const labels = screen.getAllByText('로그아웃');
    await fireEvent.press(labels[labels.length - 1]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('취소하면 그대로 둔다', async () => {
    await loaded();
    await fireEvent.press(screen.getByText('로그아웃'));
    await fireEvent.press(await screen.findByText('취소'));
    expect(signOut).not.toHaveBeenCalled();
  });
});

test.each([
  [new Error('네트워크 오류'), '네트워크 오류'],
  ['boom', '동의 문서를 불러오지 못했어요.'],
])('못 불러오면 이유와 다시 불러오기를 둔다 (%#)', async (cause, message) => {
  consentEntry.mockRejectedValueOnce(cause);
  await render(<SettingsScreen />);

  expect(await screen.findByText(message)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 불러오기'));
  expect(await screen.findByText('이용약관')).toBeOnTheScreen();
});

test('아직 결정하지 않은 필수 문서에는 동의됨 표시가 없다', async () => {
  consentEntry.mockResolvedValue({
    entry_status: 'decision_required',
    documents: [doc('d-terms', 'terms', '이용약관', true, null)],
    undecided_documents: [],
  });
  await render(<SettingsScreen />);

  expect(await screen.findByText('판 v3 · 시행 2026.01.01 · 아직 결정하지 않음')).toBeOnTheScreen();
  expect(screen.queryByText('동의됨')).not.toBeOnTheScreen();
});

test('선택 문서가 없으면 선택 동의 칸을 그리지 않는다', async () => {
  consentEntry.mockResolvedValue({ entry_status: 'allowed', documents: [], undecided_documents: [] });
  await render(<SettingsScreen />);

  expect(await screen.findByText('알림')).toBeOnTheScreen();
  expect(screen.queryByText('선택 동의')).not.toBeOnTheScreen();
  expect(screen.queryByText('필수 동의')).not.toBeOnTheScreen();
});

test('뒤로는 이전 화면으로 간다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

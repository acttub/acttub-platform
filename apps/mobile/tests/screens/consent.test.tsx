import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ConsentScreen from '@/app/consent';
import type { ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { showMarketingNotice } from '@/lib/marketing-notice';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/marketing-notice', () => ({ showMarketingNotice: jest.fn() }));

const submitSignup = jest.fn();
const reloadSignupDocuments = jest.fn();
const cancelSignup = jest.fn();

function doc(id: string, type: string, title: string, required: boolean): ConsentDocument {
  return { id, type, version: 'v1', title, body: `${title} 본문`, required, published_at: '2026-01-01T00:00:00Z' };
}

const terms = doc('d-terms', 'terms', '이용약관', true);
const privacy = doc('d-privacy', 'privacy', '개인정보 처리방침', true);
const retention = doc('d-ret', 'post_withdrawal_retention', '탈퇴 후 보관', false);
const email = doc('d-email', 'marketing_email', '광고성 이메일', false);
const push = doc('d-push', 'marketing_push', '광고성 푸시', false);
const voice = doc('d-voice', 'cloud_voice', '고품질 목소리', false);
const allDocs = [retention, email, terms, voice, push, privacy];

function auth(documents: ConsentDocument[] | null = allDocs) {
  (useAuth as jest.Mock).mockReturnValue({
    signup: documents ? { documents } : null,
    submitSignup,
    reloadSignupDocuments,
    cancelSignup,
  });
}

const row = (name: string | RegExp) => screen.getByRole('checkbox', { name });
const cta = () => screen.getByText('동의하고 시작하기');
const decisionsSent = () => Object.fromEntries(submitSignup.mock.calls[0][0] as Map<string, string>);

beforeEach(() => {
  jest.clearAllMocks();
  auth();
});

test('줄은 넷이다 — 필수 둘, 선택 둘(탈퇴 후 영상·녹음 보관, 혜택·이벤트 소식)이고 기능 안에서 묻는 문서는 보이지 않는다', async () => {
  await render(<ConsentScreen />);

  expect(screen.getByText('시작하기 전에\n동의가 필요해요')).toBeOnTheScreen();
  expect(screen.getByText('필수 2개만 동의하면 바로 시작할 수 있어요.')).toBeOnTheScreen();
  expect(screen.getAllByRole('checkbox').map((n) => n.props.accessibilityLabel ?? null)).toEqual([
    '필수 만 14세 이상 · 이용약관',
    '필수 개인정보 처리 · AI 분석',
    '선택 탈퇴 후 영상·녹음 보관',
    '선택 혜택·이벤트 소식 받기',
    null, // 모두 동의하기
  ]);
  expect(screen.queryByText(/고품질 목소리/)).not.toBeOnTheScreen();
  expect(screen.getByText('모두 동의하기')).toBeOnTheScreen();
  expect(cta()).toBeDisabled();
});

test('필수 둘에 동의해야 시작할 수 있고, 고른 것만 보낸다(만 14세 확인은 이용약관 줄이 함께 켠다)', async () => {
  submitSignup.mockResolvedValue(true);
  const alert = showMarketingNotice as jest.Mock;
  await render(<ConsentScreen />);

  await fireEvent.press(row(/이용약관/));
  expect(cta()).toBeDisabled();
  await fireEvent.press(row(/개인정보 처리/));
  expect(cta()).toBeEnabled();

  await fireEvent.press(cta());

  expect(decisionsSent()).toEqual({ 'd-terms': 'granted', 'd-privacy': 'granted' });
  expect(alert).not.toHaveBeenCalled();
});

test('필수 줄을 다시 누르면 결정을 비워 다시 막는다', async () => {
  await render(<ConsentScreen />);
  await agreeRequired();
  await fireEvent.press(row(/이용약관/));

  expect(row(/이용약관/)).not.toBeChecked();
  expect(cta()).toBeDisabled();
});

test('모두 동의하기는 선택까지 전부 켜고, 다시 누르면 끈다. 켠 뒤에도 줄마다 끌 수 있다', async () => {
  await render(<ConsentScreen />);

  await fireEvent.press(row(/모두 동의하기/));
  expect(row(/모두 동의하기/)).toBeChecked();
  expect(row(/이용약관/)).toBeChecked();
  expect(row(/탈퇴 후 영상·녹음 보관/)).toBeChecked();
  expect(row(/혜택·이벤트 소식/)).toBeChecked();
  expect(cta()).toBeEnabled();

  await fireEvent.press(row(/탈퇴 후 영상·녹음 보관/));
  expect(row(/모두 동의하기/)).not.toBeChecked();
  await fireEvent.press(row(/탈퇴 후 영상·녹음 보관/));
  expect(row(/모두 동의하기/)).toBeChecked();
  await fireEvent.press(row(/모두 동의하기/));
  expect(row(/이용약관/)).not.toBeChecked();
  expect(cta()).toBeDisabled();
});

test('선택 줄 둘은 따로 켜고 끈다 — 탈퇴 후 보관만 켜면 광고성 정보는 거절로 간다', async () => {
  submitSignup.mockResolvedValue(true);
  await render(<ConsentScreen />);
  await agreeRequired();
  await fireEvent.press(row(/탈퇴 후 영상·녹음 보관/));

  expect(row(/혜택·이벤트 소식/)).not.toBeChecked();
  await fireEvent.press(cta());
  expect(decisionsSent()).toEqual({ 'd-terms': 'granted', 'd-privacy': 'granted', 'd-ret': 'granted' });
});

test('혜택·이벤트 소식에 동의하고 가입하면 이메일·푸시를 함께 보내고 처리 결과를 다음 화면 위 안내(S5.13)로 보낸다', async () => {
  submitSignup.mockResolvedValue(true);
  const alert = showMarketingNotice as jest.Mock;
  await render(<ConsentScreen />);
  await agreeRequired();
  await fireEvent.press(row(/혜택·이벤트 소식/));
  await fireEvent.press(cta());

  expect(decisionsSent()).toEqual({
    'd-terms': 'granted',
    'd-privacy': 'granted',
    'd-email': 'granted',
    'd-push': 'granted',
  });
  expect(alert).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '광고성 정보 수신에 동의했어요',
      sender: 'Acttub',
      date: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}$/),
      rows: [
        { channel: '이메일', result: '수신 동의', granted: true },
        { channel: '앱 푸시', result: '수신 동의', granted: true },
      ],
    }),
  );
});

test('화살표를 누르면 문서 본문을 펼치고 다시 누르면 접는다', async () => {
  await render(<ConsentScreen />);
  const [firstArrow] = screen.getAllByRole('button', { name: '보기' });

  await fireEvent.press(firstArrow);
  expect(screen.getByText('이용약관 본문')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '접기' }));
  expect(screen.queryByText('이용약관 본문')).not.toBeOnTheScreen();

  const arrows = screen.getAllByRole('button', { name: '보기' });
  await fireEvent.press(arrows[arrows.length - 1]);
  expect(screen.getByText('광고성 이메일 본문')).toBeOnTheScreen();
  expect(screen.getByText('광고성 푸시 본문')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '접기' }));
  expect(screen.queryByText('광고성 이메일 본문')).not.toBeOnTheScreen();
});

async function agreeRequired() {
  await fireEvent.press(row(/이용약관/));
  await fireEvent.press(row(/개인정보 처리/));
}

test('보는 사이 문서가 바뀌었으면 알리고 문서를 다시 받는다', async () => {
  submitSignup.mockRejectedValue(Object.assign(new Error('old'), { code: 'consent_document_outdated' }));
  reloadSignupDocuments.mockRejectedValue(new Error('down'));
  await render(<ConsentScreen />);
  await agreeRequired();

  await fireEvent.press(cta());

  expect(await screen.findByText('동의 문서가 새로 바뀌었어요. 다시 확인해주세요.')).toBeOnTheScreen();
  expect(reloadSignupDocuments).toHaveBeenCalledTimes(1);
});

test.each([
  [new Error('이미 가입한 계정이에요'), '이미 가입한 계정이에요'],
  ['boom', '동의 기록에 실패했어요. 다시 시도해주세요.'],
])('가입이 실패하면 이유를 보여 준다 (%#)', async (cause, message) => {
  submitSignup.mockRejectedValue(cause);
  await render(<ConsentScreen />);
  await agreeRequired();

  await fireEvent.press(cta());
  expect(await screen.findByText(message)).toBeOnTheScreen();
});

test('보내는 동안 모든 줄과 나가기를 막는다', async () => {
  let finish!: (v: boolean) => void;
  submitSignup.mockReturnValue(new Promise((r) => (finish = r)));
  await render(<ConsentScreen />);
  await agreeRequired();

  await fireEvent.press(cta());
  expect(screen.queryByText('동의하고 시작하기')).not.toBeOnTheScreen();
  expect(row(/탈퇴 후 영상·녹음 보관/)).toBeDisabled();
  expect(screen.getByRole('button', { name: '동의하지 않고 나가기' })).toBeDisabled();

  await act(async () => finish(false));
  expect(cta()).toBeEnabled();
});

test('나가기를 누르면 가입을 취소한다', async () => {
  await render(<ConsentScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '동의하지 않고 나가기' }));
  expect(cancelSignup).toHaveBeenCalledTimes(1);
});

test('진행 중인 가입이 없으면 아무것도 그리지 않는다', async () => {
  auth(null);
  await render(<ConsentScreen />);
  expect(screen.toJSON()).toBeNull();
});

test('선택 문서가 없으면 그 줄을 그리지 않는다', async () => {
  auth([terms, privacy]);
  await render(<ConsentScreen />);
  expect(screen.getByText('시작하기 전에\n동의가 필요해요')).toBeOnTheScreen();
  expect(screen.queryByText('혜택·이벤트 소식 받기')).not.toBeOnTheScreen();
  expect(screen.queryByText('탈퇴 후 영상·녹음 보관')).not.toBeOnTheScreen();
});

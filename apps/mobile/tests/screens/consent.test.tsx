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
const cta = () => screen.getByText('동의하고 계속하기');
const decisionsSent = () => Object.fromEntries(submitSignup.mock.calls[0][0] as Map<string, string>);

beforeEach(() => {
  jest.clearAllMocks();
  auth();
});

test('필수를 먼저, 선택을 뒤에 두고 기능 안에서 묻는 문서는 보이지 않는다', async () => {
  await render(<ConsentScreen />);

  expect(screen.getAllByText(/^\[(필수|선택)\]/).map((n) => n.props.children)).toEqual([
    '[필수] 만 14세 이상이에요',
    '[필수] 이용약관',
    '[필수] 개인정보 처리방침',
    '[선택] 탈퇴 후 보관',
    '[선택] 광고성 정보 (이메일 · 앱 푸시)',
  ]);
  expect(screen.getAllByRole('checkbox')).toHaveLength(8);
  expect(screen.queryByText(/고품질 목소리/)).not.toBeOnTheScreen();
  expect(cta()).toBeDisabled();
});

test('만 14세 확인과 필수 문서에 모두 동의해야 계속할 수 있고, 고른 것만 보낸다', async () => {
  submitSignup.mockResolvedValue(true);
  const alert = showMarketingNotice as jest.Mock;
  await render(<ConsentScreen />);

  await fireEvent.press(row(/이용약관/));
  await fireEvent.press(row(/개인정보 처리방침/));
  expect(cta()).toBeDisabled();
  await fireEvent.press(row(/만 14세 이상이에요/));
  expect(cta()).toBeEnabled();

  await fireEvent.press(cta());

  expect(decisionsSent()).toEqual({ 'd-terms': 'granted', 'd-privacy': 'granted' });
  expect(alert).not.toHaveBeenCalled();
});

test('필수 문서를 다시 누르면 결정을 비워 다시 막는다', async () => {
  await render(<ConsentScreen />);
  await fireEvent.press(row(/만 14세 이상이에요/));
  await fireEvent.press(row(/이용약관/));
  await fireEvent.press(row(/개인정보 처리방침/));
  await fireEvent.press(row(/이용약관/));

  expect(row(/이용약관/)).not.toBeChecked();
  expect(cta()).toBeDisabled();
});

test('전체 동의는 보이는 것 전부를 켜고 다시 누르면 끈다', async () => {
  await render(<ConsentScreen />);

  await fireEvent.press(row(/전체 동의/));
  expect(row(/전체 동의/)).toBeChecked();
  expect(row(/만 14세 이상이에요/)).toBeChecked();
  expect(row(/\[선택\] 탈퇴 후 보관/)).toBeChecked();
  expect(row(/\[선택\] 광고성 정보 \(/)).toBeChecked();

  await fireEvent.press(row(/\[선택\] 탈퇴 후 보관/));
  expect(row(/전체 동의/)).not.toBeChecked();
  await fireEvent.press(row(/\[선택\] 탈퇴 후 보관/));
  await fireEvent.press(row(/전체 동의/));
  expect(row(/이용약관/)).not.toBeChecked();
  expect(row(/만 14세 이상이에요/)).not.toBeChecked();
});

test('광고성 정보에 동의하고 가입하면 처리 결과를 다음 화면 위 팝업(S5.13)으로 보낸다', async () => {
  submitSignup.mockResolvedValue(true);
  const alert = showMarketingNotice as jest.Mock;
  await render(<ConsentScreen />);

  await fireEvent.press(row(/만 14세 이상이에요/));
  await fireEvent.press(row(/이용약관/));
  await fireEvent.press(row(/개인정보 처리방침/));
  await fireEvent.press(row(/^\S+ 앱 푸시$/));
  expect(row(/\[선택\] 광고성 정보 \(/)).not.toBeChecked();
  await fireEvent.press(cta());

  expect(decisionsSent()).toEqual({ 'd-terms': 'granted', 'd-privacy': 'granted', 'd-push': 'granted' });
  expect(alert).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '광고성 정보 수신 설정을 바꿨어요',
      sender: 'Acttub',
      date: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}$/),
      rows: [
        { channel: '이메일', result: '수신 거부', granted: false },
        { channel: '앱 푸시', result: '수신 동의', granted: true },
      ],
    }),
  );
});

test('광고성 묶음 줄은 이메일·푸시를 함께 켜고 끈다', async () => {
  await render(<ConsentScreen />);

  await fireEvent.press(row(/\[선택\] 광고성 정보 \(/));
  expect(row(/^\S+ 이메일$/)).toBeChecked();
  expect(row(/^\S+ 앱 푸시$/)).toBeChecked();

  await fireEvent.press(row(/\[선택\] 광고성 정보 \(/));
  expect(row(/^\S+ 이메일$/)).not.toBeChecked();
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

test('제목 아래 파란 안내 줄은 처음엔 전체 동의를, 필수를 다 고르면 계속하기를 알려 준다', async () => {
  await render(<ConsentScreen />);

  expect(screen.getByText('Acttub를 쓰려면 동의가 필요해요')).toBeOnTheScreen();
  expect(screen.getByText('「전체 동의」 한 번이면 준비 끝이에요!')).toBeOnTheScreen();
  expect(screen.queryByText('준비 끝! 이제 「동의하고 계속하기」만 누르면 돼요')).not.toBeOnTheScreen();

  await agreeRequired();
  expect(screen.getByText('준비 끝! 이제 「동의하고 계속하기」만 누르면 돼요')).toBeOnTheScreen();
  expect(screen.queryByText('「전체 동의」 한 번이면 준비 끝이에요!')).not.toBeOnTheScreen();

  await fireEvent.press(row(/이용약관/));
  expect(screen.getByText('「전체 동의」 한 번이면 준비 끝이에요!')).toBeOnTheScreen();
});

async function agreeRequired() {
  await fireEvent.press(row(/만 14세 이상이에요/));
  await fireEvent.press(row(/이용약관/));
  await fireEvent.press(row(/개인정보 처리방침/));
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
  expect(screen.queryByText('동의하고 계속하기')).not.toBeOnTheScreen();
  expect(row(/\[선택\] 탈퇴 후 보관/)).toBeDisabled();
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

test('광고성 문서가 없으면 묶음 줄을 그리지 않는다', async () => {
  auth([terms, privacy]);
  await render(<ConsentScreen />);
  expect(screen.getByText('Acttub를 쓰려면 동의가 필요해요')).toBeOnTheScreen();
  expect(screen.queryByText("[선택] 광고성 정보 (이메일 · 앱 푸시)")).not.toBeOnTheScreen();
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { MarketingNoticeDialog, MarketingNoticeHost } from '@/components/marketing-notice-dialog';
import { marketingDecisionNotice } from '@/lib/marketing-consent';
import { showMarketingNotice } from '@/lib/marketing-notice';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const AT = new Date(2026, 9, 19, 14, 0);
const granted = marketingDecisionNotice(
  [
    { type: 'marketing_email', decision: 'granted' },
    { type: 'marketing_push', decision: 'granted' },
  ],
  AT,
)!;

afterEach(() => jest.useRealTimers());

test('어두운 토스트에 제목 · 매체 · 보낸 곳 · 처리일 · 바꾸는 곳 안내를 보이고, 누르면 닫는다', async () => {
  const onClose = jest.fn();
  await render(<MarketingNoticeDialog notice={granted} onClose={onClose} />);

  expect(screen.getByText('광고성 정보 수신에 동의했어요')).toBeOnTheScreen();
  expect(screen.getByText('이메일 · 앱 푸시 · Acttub · 2026.10.19')).toBeOnTheScreen();
  expect(screen.getByText('설정 > 동의 내역에서 언제든 바꿀 수 있어요.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('marketing-notice-card'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('결과가 섞이면 매체마다 결과를 붙인다', async () => {
  const mixed = marketingDecisionNotice(
    [
      { type: 'marketing_email', decision: 'granted' },
      { type: 'marketing_push', decision: 'declined' },
    ],
    AT,
  )!;
  await render(<MarketingNoticeDialog notice={mixed} onClose={jest.fn()} />);
  expect(screen.getByText(/이메일 수신 동의 · 앱 푸시 수신 거부/)).toBeOnTheScreen();
});

test('알림이 없으면 아무것도 그리지 않는다', async () => {
  await render(<MarketingNoticeDialog notice={null} onClose={jest.fn()} />);
  expect(screen.toJSON()).toBeNull();
});

test('앱 전체 자리는 다른 화면이 보낸 결과를 띄우고 누르면 닫는다 — 가입 뒤 다음 화면 위에 뜬다', async () => {
  await render(<MarketingNoticeHost />);
  expect(screen.queryByText('광고성 정보 수신에 동의했어요')).not.toBeOnTheScreen();

  await act(async () => showMarketingNotice(granted));
  expect(screen.getByText('광고성 정보 수신에 동의했어요')).toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('marketing-notice-card'));
  expect(screen.queryByText('광고성 정보 수신에 동의했어요')).not.toBeOnTheScreen();
});

test('일정 시간이 지나면 스스로 닫는다', async () => {
  jest.useFakeTimers();
  const onClose = jest.fn();
  await render(<MarketingNoticeDialog notice={granted} onClose={onClose} />);
  await act(async () => jest.advanceTimersByTime(7000));
  expect(onClose).toHaveBeenCalledTimes(1);
});

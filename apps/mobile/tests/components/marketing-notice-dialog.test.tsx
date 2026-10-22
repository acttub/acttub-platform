import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { MarketingNoticeDialog, MarketingNoticeHost } from '@/components/marketing-notice-dialog';
import { marketingDecisionNotice } from '@/lib/marketing-consent';
import { showMarketingNotice } from '@/lib/marketing-notice';

const AT = new Date(2026, 9, 19, 14, 0);
const granted = marketingDecisionNotice(
  [
    { type: 'marketing_email', decision: 'granted' },
    { type: 'marketing_push', decision: 'granted' },
  ],
  AT,
)!;

test('S5.13처럼 보낸 곳·처리일·매체별 결과를 회색 표로 보여 주고 확인 하나만 둔다', async () => {
  const onClose = jest.fn();
  await render(<MarketingNoticeDialog notice={granted} onClose={onClose} />);

  expect(screen.getByText('광고성 정보 수신에 동의했어요')).toBeOnTheScreen();
  for (const text of ['보낸 곳', 'Acttub', '처리일', '2026.10.19', '이메일', '앱 푸시']) expect(screen.getByText(text)).toBeOnTheScreen();
  expect(screen.getAllByText('수신 동의')).toHaveLength(2);
  expect(screen.getByText('설정 > 동의 내역에서 언제든 바꿀 수 있어요.')).toBeOnTheScreen();
  expect(screen.queryByText('취소')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('확인'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('pen S5.13 수치 — 폭 292·모서리 20 카드, 동의 값은 파랑, 확인은 꽉 찬 높이 46 버튼', async () => {
  await render(<MarketingNoticeDialog notice={granted} onClose={jest.fn()} />);

  expect(screen.getByTestId('marketing-notice-card')).toHaveStyle({ width: 292, borderRadius: 20 });
  expect(screen.getAllByText('수신 동의')[0]).toHaveStyle({ color: '#4880EE', fontSize: 14, fontWeight: '700' });
  expect(screen.getByRole('button', { name: '확인' })).toHaveStyle({ height: 46, borderRadius: 14 });
});

test('알림이 없으면 아무것도 그리지 않는다', async () => {
  await render(<MarketingNoticeDialog notice={null} onClose={jest.fn()} />);
  expect(screen.toJSON()).toBeNull();
});

test('앱 전체 자리는 다른 화면이 보낸 결과를 띄우고 확인하면 닫는다 — 가입 뒤 다음 화면 위에 뜬다', async () => {
  await render(<MarketingNoticeHost />);
  expect(screen.queryByText('광고성 정보 수신에 동의했어요')).not.toBeOnTheScreen();

  await act(async () => showMarketingNotice(granted));
  expect(screen.getByText('광고성 정보 수신에 동의했어요')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('확인'));
  expect(screen.queryByText('광고성 정보 수신에 동의했어요')).not.toBeOnTheScreen();
});

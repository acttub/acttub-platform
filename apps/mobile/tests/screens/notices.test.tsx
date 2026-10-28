import { fireEvent, render, screen } from '@testing-library/react-native';

import NoticeDetailScreen from '@/app/notice-detail';
import NoticesScreen from '@/app/notices';
import { api } from '@/lib/api';
import { forgetNotices, type Notice } from '@/lib/notices';

jest.mock('@/lib/api', () => ({ api: { getNotices: jest.fn() } }));
jest.mock('expo-image', () => ({
  Image: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'notice-image' }),
}));
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: { slug?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));

const getNotices = api.getNotices as jest.Mock;

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    slug: 'terms-billing-2026-11', revision: 1, live: true, published_at: '2026-10-27T00:00:00Z', ends_at: null,
    badge: '안내', title: '약관 개정과 11월 결제 안내', body: '11월부터 Pro 가 생겨요.', image_url: null,
    image_asset: 'mascot-reading', cta_label: '요금 보기', cta_action: 'route', cta_target: '/pro', ...overrides,
  };
}
const ENDED = notice({ slug: 'cloud-voice-launch', live: false, ends_at: '2026-10-31T15:00:00Z', title: '고품질 목소리 출시', published_at: '2026-09-01T00:00:00Z', cta_label: null, cta_action: 'none', cta_target: null });

beforeEach(() => {
  jest.clearAllMocks();
  forgetNotices();
  mockParams = {};
});

describe('공지사항 목록', () => {
  test('받는 동안은 뼈대를 보이고, 받으면 서버 순서대로 진행 중·종료 표시와 날짜를 보인다', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    getNotices.mockReturnValue(new Promise((r) => { resolve = r; }));
    await render(<NoticesScreen />);
    expect(screen.queryByText('약관 개정과 11월 결제 안내')).not.toBeOnTheScreen();

    resolve({ notices: [notice(), ENDED] });
    expect(await screen.findByText('약관 개정과 11월 결제 안내')).toBeOnTheScreen();
    expect(screen.getByText('진행 중')).toBeOnTheScreen();
    expect(screen.getByText('종료')).toBeOnTheScreen();
    expect(screen.getByText('2026년 10월 27일')).toBeOnTheScreen();
    expect(getNotices).toHaveBeenCalledWith({ platform: expect.stringMatching(/ios|android/), locale: 'ko' });
  });

  test('한 줄을 누르면 그 공지 상세로 간다', async () => {
    getNotices.mockResolvedValue({ notices: [notice(), ENDED] });
    await render(<NoticesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '고품질 목소리 출시' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/notice-detail', params: { slug: 'cloud-voice-launch' } });
  });

  test('공지가 없으면 빈 안내를, 못 받으면 오류 상자를 보이고 다시 시도하면 다시 받는다', async () => {
    getNotices.mockResolvedValueOnce({ notices: [] });
    await render(<NoticesScreen />);
    expect(await screen.findByText('아직 공지가 없어요')).toBeOnTheScreen();
    await screen.unmount();

    getNotices.mockRejectedValueOnce(new Error('down'));
    await render(<NoticesScreen />);
    expect(await screen.findByText('공지를 불러오지 못했어요')).toBeOnTheScreen();
    getNotices.mockResolvedValueOnce({ notices: [notice()] });
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('약관 개정과 11월 결제 안내')).toBeOnTheScreen();
  });

  test('뒤로 버튼은 이전 화면으로 간다', async () => {
    getNotices.mockResolvedValue({ notices: [] });
    await render(<NoticesScreen />);
    await screen.findByText('아직 공지가 없어요');
    await fireEvent.press(screen.getByRole('button', { name: /뒤로|back/i }));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('공지사항 상세', () => {
  test('목록 없이 열리면 목록을 받아 같은 slug 의 제목·배지·날짜·본문·그림·버튼을 보인다', async () => {
    mockParams = { slug: 'terms-billing-2026-11' };
    getNotices.mockResolvedValue({ notices: [ENDED, notice()] });
    await render(<NoticeDetailScreen />);
    expect(await screen.findByText('약관 개정과 11월 결제 안내')).toBeOnTheScreen();
    expect(screen.getByText('안내')).toBeOnTheScreen();
    expect(screen.getByText('11월부터 Pro 가 생겨요.')).toBeOnTheScreen();
    expect(screen.getByText('2026년 10월 27일')).toBeOnTheScreen();
    expect(screen.getByTestId('notice-image')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '요금 보기' }));
    expect(mockPush).toHaveBeenCalledWith('/pro');
  });

  test('끝난 공지는 버튼 없이 내용만 보이고, 서버가 준 이미지 주소를 쓴다', async () => {
    mockParams = { slug: 'cloud-voice-launch' };
    getNotices.mockResolvedValue({ notices: [{ ...ENDED, cta_label: '무료로 켜기', cta_action: 'route', cta_target: '/reading', image_url: 'https://img.test/a.png', image_asset: null }] });
    await render(<NoticeDetailScreen />);
    expect(await screen.findByText('고품질 목소리 출시')).toBeOnTheScreen();
    expect(screen.getByText('종료')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '무료로 켜기' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('notice-image').props.source).toEqual({ uri: 'https://img.test/a.png' });
  });

  test('목록에 없는 slug 면 찾을 수 없다는 안내와 목록으로 돌아가는 버튼을 보인다', async () => {
    mockParams = { slug: 'gone' };
    getNotices.mockResolvedValue({ notices: [notice()] });
    await render(<NoticeDetailScreen />);
    expect(await screen.findByText('공지를 찾을 수 없어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '목록으로' }));
    expect(mockBack).toHaveBeenCalled();
  });

  test('못 받으면 오류 상자를 보이고 다시 시도하면 공지를 보인다', async () => {
    mockParams = { slug: 'terms-billing-2026-11' };
    getNotices.mockRejectedValueOnce(new Error('down'));
    await render(<NoticeDetailScreen />);
    expect(await screen.findByText('공지를 불러오지 못했어요')).toBeOnTheScreen();
    getNotices.mockResolvedValueOnce({ notices: [notice()] });
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('약관 개정과 11월 결제 안내')).toBeOnTheScreen();
  });
});

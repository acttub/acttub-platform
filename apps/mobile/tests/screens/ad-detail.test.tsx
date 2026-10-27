import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AdDetailScreen from '@/app/ad/[id]';
import { api } from '@/lib/api';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: 'ad-1' }),
}));
jest.mock('@/lib/api', () => ({ api: { getAd: jest.fn() } }));

const getAd = api.getAd as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test('학원 정보를 그대로 보이고, 버튼은 학원 외부 링크를 연다', async () => {
  getAd.mockResolvedValue({
    id: 'ad-1', advertiser_name: '한빛연기학원', academy_registration_no: '제2026-1호', course_name: '연기 입시',
    tuition: '월 40만원(교재비 포함)', headline: '겨울 입시반', body: '소수 정원', image_url: 'https://cdn/a.png',
    link_url: 'https://example.com',
  });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const view = await render(<AdDetailScreen />);
  expect(await screen.findByText('제2026-1호')).toBeOnTheScreen();
  expect(screen.getByText('연기 입시')).toBeOnTheScreen();
  expect(screen.getByText('월 40만원(교재비 포함)')).toBeOnTheScreen();
  expect(screen.getByText('겨울 입시반')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('학원 페이지 열기'));
  expect(open).toHaveBeenCalledWith('https://example.com');
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(mockBack).toHaveBeenCalled();
  await view.unmount();
  open.mockRestore();
});

test('빈 칸은 「-」, 링크가 없으면 버튼이 없다', async () => {
  getAd.mockResolvedValue({
    id: 'ad-1', advertiser_name: null, academy_registration_no: null, course_name: null, tuition: null,
    headline: null, body: null, image_url: null, link_url: null,
  });
  const view = await render(<AdDetailScreen />);
  expect((await screen.findAllByText('-')).length).toBe(4);
  expect(screen.queryByText('학원 페이지 열기')).not.toBeOnTheScreen();
  await view.unmount();
});

test('못 불러오면 안내한다', async () => {
  getAd.mockRejectedValue(new Error('404'));
  const view = await render(<AdDetailScreen />);
  expect(await screen.findByText('광고 정보를 불러오지 못했어요.')).toBeOnTheScreen();
  await view.unmount();
});

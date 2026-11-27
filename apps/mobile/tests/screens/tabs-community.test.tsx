import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CommunityScreen from '@/app/(tabs)/community';
import { api } from '@/lib/api';
import { kstDate } from '@/lib/auditions';

/**
 * 커뮤니티 탭(SOMA-1121) — 맨 위 「오디션·입시」 입구(예전 홈의 마감 임박 구역) 아래 게시판.
 */

const mockRouter = { push: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
const mockAuth = { profile: { me: { id: 'u1' } as { id: string; profile?: { experience: string; birth_date: string | null } } } };
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/api', () => ({
  api: {
    auditions: jest.fn(),
    admissions: jest.fn(),
    communityCategories: jest.fn(),
    communityPosts: jest.fn(),
    unreadNotificationCount: jest.fn(async () => ({ count: 0 })),
  },
}));
// 앱을 켤 때 받은 기록을 기다리지 않는다.
jest.mock('@/lib/launch-splash', () => ({ ...jest.requireActual('@/lib/launch-splash'), afterHomeReady: () => Promise.resolve() }));
jest.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ count: 0, badge: null }) }));

const DAY = 24 * 60 * 60 * 1000;
const kstDaysFromNow = (n: number) => kstDate(new Date(Date.now() + n * DAY));

const auditionsPayload = {
  collected_at: '2026-10-01T00:00:00Z',
  items: [
    { id: 'a1', title: '단편영화 주연', category: 'short_film', source: 'x', source_name: '필름메이커스', apply_end: kstDaysFromNow(3), source_url: 'https://x' },
    { id: 'a2', title: '광고 모델', category: 'commercial', source: 'y', source_name: '오디션원', apply_end: kstDaysFromNow(0), source_url: 'https://y' },
    { id: 'a3', title: '지난 공고', category: 'drama', source: 'z', source_name: '방송사', apply_end: kstDaysFromNow(-2), source_url: 'https://z' },
    { id: 'a4', title: '웹드라마 조연', category: 'drama', source: 'z', source_name: '방송사', apply_end: kstDaysFromNow(6), source_url: 'https://z' },
    { id: 'a5', title: '뮤직비디오', category: 'mv', source: 'z', source_name: '방송사', apply_end: kstDaysFromNow(9), source_url: 'https://z' },
  ],
};
const admissionsPayload = {
  updated_at: '2026-10-01',
  disclaimer: '',
  universities: [{ id: 'u-a', name: '한국예술종합학교', admission_url: 'https://a', resources: [], tips: [] }],
  notices: [
    {
      id: 'n-a',
      university_id: 'u-a',
      department: '연기과',
      apply_start: null,
      apply_end: kstDaysFromNow(0),
      designated_works: [],
      essay_questions: [],
      stages: [],
      practical_items: [],
      results: [],
    },
  ],
};
const year = new Date().getFullYear();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAuth.profile = { me: { id: 'u1' } };
  (api.auditions as jest.Mock).mockResolvedValue(auditionsPayload);
  (api.admissions as jest.Mock).mockResolvedValue(admissionsPayload);
  (api.communityCategories as jest.Mock).mockResolvedValue({ categories: [{ slug: 'free', name: '자유' }] });
  (api.communityPosts as jest.Mock).mockResolvedValue({ posts: [], next_cursor: null });
});

test('맨 위에 오디션 마감 임박 세 줄을 D-day와 함께 보이고(지난 공고는 빼고), 그 아래 게시판이다', async () => {
  await render(<CommunityScreen />);

  expect(await screen.findByText('오디션 마감 임박')).toBeOnTheScreen();
  expect(screen.getByText('광고 모델')).toBeOnTheScreen();
  expect(screen.getByText('D-DAY')).toBeOnTheScreen();
  expect(screen.getByText('단편영화 주연')).toBeOnTheScreen();
  expect(screen.getByText('웹드라마 조연')).toBeOnTheScreen();
  expect(screen.queryByText('뮤직비디오')).not.toBeOnTheScreen();
  expect(screen.queryByText('지난 공고')).not.toBeOnTheScreen();
  // 입시생이 아니면 연기 입시 구역은 없고 받지도 않는다.
  expect(screen.queryByText('연기 입시')).not.toBeOnTheScreen();
  expect(api.admissions).not.toHaveBeenCalled();
  // 게시판(공지·글쓰기)이 아래에 그대로 있다.
  expect(await screen.findByRole('button', { name: '게시판 이용 규칙' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '글쓰기' })).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('광고 모델'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/auditions');
  await fireEvent.press(screen.getByRole('link', { name: '오디션 공고 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/auditions');
});

test('만 19세 이하 입시생은 연기 입시만 보고, 전체 보기는 입시 일정으로 간다', async () => {
  mockAuth.profile = { me: { id: 'u1', profile: { experience: 'exam_prep', birth_date: `${year - 18}-01-01` } } };
  await render(<CommunityScreen />);

  expect(await screen.findByText('연기 입시')).toBeOnTheScreen();
  expect(screen.getByText('한국예술종합학교')).toBeOnTheScreen();
  expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: '연기 입시 정보 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/admissions');
});

test('만 20세 이상 입시생은 입시·오디션 둘 다 보고, 구역마다 두 줄씩이다', async () => {
  mockAuth.profile = { me: { id: 'u1', profile: { experience: 'exam_prep', birth_date: `${year - 25}-01-01` } } };
  await render(<CommunityScreen />);

  expect(await screen.findByText('연기 입시')).toBeOnTheScreen();
  expect(await screen.findByText('오디션 마감 임박')).toBeOnTheScreen();
  expect(screen.getByText('광고 모델')).toBeOnTheScreen();
  expect(screen.getByText('단편영화 주연')).toBeOnTheScreen();
  expect(screen.queryByText('웹드라마 조연')).not.toBeOnTheScreen();
});

test('공고를 못 받으면 입구는 그리지 않고 게시판은 그대로다', async () => {
  (api.auditions as jest.Mock).mockRejectedValue(new Error('down'));
  await render(<CommunityScreen />);

  expect(await screen.findByRole('button', { name: '게시판 이용 규칙' })).toBeOnTheScreen();
  await waitFor(() => expect(api.auditions).toHaveBeenCalled());
  expect(screen.queryByTestId('deadline-preview')).not.toBeOnTheScreen();
});

test('머리는 「커뮤니티」 제목과 알림 종이다', async () => {
  await render(<CommunityScreen />);
  expect(screen.getByRole('header', { name: '커뮤니티' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '알림함' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
});

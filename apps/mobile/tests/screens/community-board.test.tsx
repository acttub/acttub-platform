import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { CommunityBoard } from '@/components/community/community-board';
import { CommunityTabs } from '@/components/community/community-tabs';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { CommunityPost } from '@/lib/community';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { communityCategories: jest.fn(), communityPosts: jest.fn() },
}));

const communityPosts = api.communityPosts as jest.Mock;
const CATEGORIES = [
  { slug: 'question', name: '질문' },
  { slug: 'audition', name: '오디션 정보' },
  { slug: 'partner', name: '상대역 구함' },
  { slug: 'free', name: '자유' },
];
const TWELVE_MIN_AGO = new Date(Date.now() - 12 * 60_000).toISOString();
const post = (over: Partial<CommunityPost> = {}): CommunityPost => ({
  id: 'p1',
  category_slug: 'question',
  category_name: '질문',
  title: '독백 2분 넘으면 감점인가요?',
  body: '입시 독백 시간이\n애매해서 질문드려요',
  like_count: 9,
  comment_count: 7,
  liked_by_me: false,
  author_name: '하늘',
  is_mine: false,
  created_at: TWELVE_MIN_AGO,
  ...over,
});

const onWrite = jest.fn();
const onSeen = jest.fn();
const renderBoard = () => render(<CommunityBoard bottomSpace={0} onWrite={onWrite} onSeen={onSeen} />);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (api.communityCategories as jest.Mock).mockResolvedValue({ categories: CATEGORIES });
});

test('분류 칩(전체 + 서버 분류)·공지 카드·글 행을 그리고, 행에는 좋아요 수가 없다', async () => {
  communityPosts.mockResolvedValue({ posts: [post(), post({ id: 'p2', category_name: '상대역 구함', title: '대사 같이 맞춰볼 분', author_name: null, comment_count: 3 })], next_cursor: null });
  await renderBoard();

  expect(await screen.findByText('독백 2분 넘으면 감점인가요?')).toBeOnTheScreen();
  for (const name of ['전체', '질문', '오디션 정보', '상대역 구함', '자유']) {
    expect(screen.getByRole('radio', { name })).toBeOnTheScreen();
  }
  expect(screen.getByRole('radio', { name: '전체' })).toBeSelected();
  expect(screen.getByText('게시판 이용 규칙')).toBeOnTheScreen();
  expect(screen.getAllByText('입시 독백 시간이 애매해서 질문드려요')).toHaveLength(2);
  expect(screen.getByText('하늘 · 12분 전')).toBeOnTheScreen();
  expect(screen.getByText(/^배우 · /)).toBeOnTheScreen();
  expect(screen.getByText('7')).toBeOnTheScreen();
  expect(screen.queryByText('9')).not.toBeOnTheScreen();
  expect(onSeen).toHaveBeenCalledWith(TWELVE_MIN_AGO);
  expect(logEvent).toHaveBeenCalledWith('community_board_open');

  await fireEvent.press(screen.getByText('독백 2분 넘으면 감점인가요?'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/community-post', params: { id: 'p1' } });
});

test('분류를 고르면 그 분류로 다시 받는다', async () => {
  communityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  await renderBoard();
  await fireEvent.press(await screen.findByRole('radio', { name: '오디션 정보' }));
  await waitFor(() => expect(communityPosts).toHaveBeenLastCalledWith({ category: 'audition' }));
  expect(screen.getByRole('radio', { name: '오디션 정보' })).toBeSelected();
});

test('글이 없으면 InlineEmpty 와 첫 글 쓰기 버튼을 보인다', async () => {
  communityPosts.mockResolvedValue({ posts: [], next_cursor: null });
  await renderBoard();
  expect(await screen.findByText('아직 글이 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '첫 글 쓰기' }));
  expect(onWrite).toHaveBeenCalled();
});

test('못 불러오면 연결이 끊겼어요 + 다시 시도', async () => {
  communityPosts.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ posts: [post()], next_cursor: null });
  await renderBoard();
  expect(await screen.findByText('연결이 끊겼어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('독백 2분 넘으면 감점인가요?')).toBeOnTheScreen();
});

test('공지 카드를 누르면 이용 규칙을 다이얼로그로 보인다', async () => {
  communityPosts.mockResolvedValue({ posts: [], next_cursor: null });
  await renderBoard();
  await fireEvent.press(await screen.findByRole('button', { name: '게시판 이용 규칙' }));
  expect(await screen.findByText(/연락처는 올릴 수 없어요/)).toBeOnTheScreen();
});

test('밑줄 탭은 고른 탭을 알리고, 새 글이 있으면 게시판 옆에 점을 단다', async () => {
  const onChange = jest.fn();
  const view = await render(<CommunityTabs value="challenge" onChange={onChange} dot />);
  expect(screen.getByRole('tab', { name: '챌린지', selected: true })).toBeOnTheScreen();
  expect(screen.getByTestId('community-board-dot')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('tab', { name: '게시판, 새 글 있음' }));
  expect(onChange).toHaveBeenCalledWith('board');

  await view.rerender(<CommunityTabs value="board" onChange={onChange} dot />);
  expect(screen.queryByTestId('community-board-dot')).not.toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '게시판', selected: true })).toBeOnTheScreen();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HistoryScreen from '@/app/(tabs)/history';
import { api } from '@/lib/api';
import type { PracticeGroup } from '@/lib/practice/types';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/api', () => ({ api: { listPracticeGroups: jest.fn(), patchPracticeGroup: jest.fn() } }));

const listPracticeGroups = api.listPracticeGroups as jest.Mock;
const patchPracticeGroup = api.patchPracticeGroup as jest.Mock;

const year = new Date().getFullYear();
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function group(overrides: Partial<PracticeGroup>): PracticeGroup {
  return {
    root_id: 'r1',
    title: null,
    ordinal_count: 1,
    in_progress_practice_id: null,
    favorite: false,
    hidden_at: null,
    tags: [],
    last_practiced_at: `${year}-08-15T03:00:00Z`,
    poster_url: null,
    practices: [],
    ...overrides,
  };
}

const cafe = group({ root_id: 'r-cafe', title: '카페 이별 장면', ordinal_count: 3, tags: ['감정', '화술'], poster_url: 'https://cdn/p.jpg?sig=1' });
const roof = group({
  root_id: 'r-roof',
  note_title: '옥상 고백',
  ordinal_count: 2,
  favorite: true,
  in_progress_practice_id: 'open-1',
  last_practiced_at: daysAgo(1),
});
const old = group({ root_id: 'r-old', situation: '.', last_practiced_at: `${year - 1}-03-02T03:00:00Z` });
const hidden = group({ root_id: 'r-hidden', title: '숨긴 연습', hidden_at: `${year}-08-01T00:00:00Z` });

beforeEach(() => {
  jest.clearAllMocks();
  listPracticeGroups.mockResolvedValue({ groups: [cafe, roof, old, hidden] });
  patchPracticeGroup.mockResolvedValue({});
});

test('묶음을 최근 순으로 월별로 보여 주고 숨긴 묶음은 뺀다', async () => {
  await render(<HistoryScreen />);

  expect(await screen.findByText('카페 이별 장면')).toBeOnTheScreen();
  expect(listPracticeGroups).toHaveBeenCalledWith('all');
  expect(screen.getByText('연습 기록')).toBeOnTheScreen();
  expect(screen.getByText('7회')).toBeOnTheScreen();
  expect(screen.getByText('4개')).toBeOnTheScreen();
  expect(screen.queryByText('숨긴 연습')).not.toBeOnTheScreen();

  const titles = screen.getAllByText(/카페 이별 장면|옥상 고백|장면 메모 없이 연습/).map((n) => n.props.children);
  expect(titles).toEqual(['옥상 고백', '카페 이별 장면', '장면 메모 없이 연습']);
  expect(screen.getByText('8월')).toBeOnTheScreen();
  expect(screen.getByText(`${year - 1}년 3월`)).toBeOnTheScreen();
  expect(screen.getByText('8월 15일')).toBeOnTheScreen();
  expect(screen.getByText('3회')).toBeOnTheScreen();
  expect(screen.getByText('감정')).toBeOnTheScreen();
  expect(screen.getByText('화술')).toBeOnTheScreen();
  expect(screen.getAllByText('대화 중')).toHaveLength(1);
});

test('같은 달의 묶음은 한 머리 아래 모으고, 날짜·태그가 없는 묶음도 보여 준다', async () => {
  const sameMonth = group({ root_id: 'r-aug', title: '8월 둘째 장면', last_practiced_at: `${year}-08-02T03:00:00Z` });
  const undated = group({ root_id: 'r-nodate', title: '날짜 없는 장면', last_practiced_at: null, tags: undefined });
  listPracticeGroups.mockResolvedValue({ groups: [cafe, sameMonth, undated] });
  await render(<HistoryScreen />);

  expect(await screen.findByText('날짜 없는 장면')).toBeOnTheScreen();
  expect(screen.getAllByText('8월')).toHaveLength(1);
  expect(screen.getByText('8월 2일')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('날짜 없는 장면'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/practice-group', params: { rootId: 'r-nodate' } });
});

test('대화 중인 묶음은 그 대화로, 나머지는 묶음 상세로 간다', async () => {
  await render(<HistoryScreen />);

  await fireEvent.press(await screen.findByText('옥상 고백'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });

  await fireEvent.press(screen.getByText('카페 이별 장면'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/practice-group', params: { rootId: 'r-cafe' } });
});

test('필터를 바꾸면 그 묶음만 보이고, 즐겨찾기가 비면 그 문구를 보여 준다', async () => {
  await render(<HistoryScreen />);
  await screen.findByText('카페 이별 장면');

  await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));
  expect(screen.getByRole('button', { name: '즐겨찾기' })).toBeSelected();
  expect(screen.getByText('옥상 고백')).toBeOnTheScreen();
  expect(screen.queryByText('카페 이별 장면')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '최근 30일' }));
  expect(screen.getByText('옥상 고백')).toBeOnTheScreen();
  expect(screen.queryByText('장면 메모 없이 연습')).not.toBeOnTheScreen();

  listPracticeGroups.mockResolvedValue({ groups: [cafe] });
  await render(<HistoryScreen />);
  await screen.findByText('카페 이별 장면');
  await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));
  expect(screen.getByText('즐겨찾기한 기록이 아직 없어요.')).toBeOnTheScreen();
});

test('기록이 없으면 첫 영상을 올리라고 안내한다', async () => {
  listPracticeGroups.mockResolvedValue({ groups: [] });
  await render(<HistoryScreen />);
  expect(await screen.findByText('아직 기록이 없어요.\n첫 영상을 올리면 여기에 카드가 쌓여요.')).toBeOnTheScreen();
  expect(screen.getByText('0회')).toBeOnTheScreen();
});

test('목록을 못 불러오면 오류 문구를 보여 준다', async () => {
  listPracticeGroups.mockRejectedValue(new Error('연결이 끊겼어요'));
  await render(<HistoryScreen />);
  expect(await screen.findByText('연결이 끊겼어요')).toBeOnTheScreen();
  expect(screen.queryByText('아직 기록이 없어요.\n첫 영상을 올리면 여기에 카드가 쌓여요.')).not.toBeOnTheScreen();
});

test('오류에 문구가 없으면 기본 문구를 쓴다', async () => {
  listPracticeGroups.mockRejectedValue('down');
  await render(<HistoryScreen />);
  expect(await screen.findByText('기록을 불러오지 못했어요.')).toBeOnTheScreen();
});

describe('길게 누른 메뉴', () => {
  async function openMenu(title: string) {
    await render(<HistoryScreen />);
    await fireEvent(await screen.findByText(title), 'longPress');
  }

  test('전체 보기는 묶음 상세로 간다', async () => {
    await openMenu('옥상 고백');
    await fireEvent.press(screen.getByText('전체 보기'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/practice-group', params: { rootId: 'r-roof' } });
  });

  test('즐겨찾기를 뒤집고 목록을 다시 읽는다', async () => {
    await openMenu('옥상 고백');
    await fireEvent.press(screen.getByText('즐겨찾기에서 빼기'));
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(2));
    expect(patchPracticeGroup).toHaveBeenCalledWith('r-roof', { favorite: false });

    await fireEvent(screen.getByText('카페 이별 장면'), 'longPress');
    await fireEvent.press(screen.getByText('즐겨찾기에 넣기'));
    await waitFor(() => expect(patchPracticeGroup).toHaveBeenLastCalledWith('r-cafe', { favorite: true }));
  });

  test('즐겨찾기 변경이 실패해도 목록을 다시 읽어 서버 상태로 맞춘다', async () => {
    patchPracticeGroup.mockRejectedValue(new Error('down'));
    await openMenu('옥상 고백');
    await fireEvent.press(screen.getByText('즐겨찾기에서 빼기'));
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(2));
  });

  test('삭제는 확인을 받은 뒤 묶음을 숨긴다', async () => {
    await openMenu('카페 이별 장면');
    await fireEvent.press(screen.getByText('삭제'));

    expect(screen.getByText('이 연습을 기록에서 삭제할까요?')).toBeOnTheScreen();
    expect(screen.getByText('기록에서 삭제해요. 영상은 그대로 있어요.')).toBeOnTheScreen();
    listPracticeGroups.mockResolvedValue({ groups: [roof, old] });
    await fireEvent.press(screen.getByText('삭제'));

    await waitFor(() => expect(screen.queryByText('카페 이별 장면')).not.toBeOnTheScreen());
    expect(patchPracticeGroup).toHaveBeenCalledWith('r-cafe', { hidden: true });
  });

  test('삭제 확인에서 취소하면 숨기지 않는다', async () => {
    await openMenu('카페 이별 장면');
    await fireEvent.press(screen.getByText('삭제'));
    await fireEvent.press(screen.getByText('취소'));

    expect(patchPracticeGroup).not.toHaveBeenCalled();
    expect(screen.getByText('카페 이별 장면')).toBeOnTheScreen();
  });

  test.each([
    [new Error('권한이 없어요'), '권한이 없어요'],
    ['down', '삭제하지 못했어요.'],
  ])('숨기기가 실패하면 까닭을 알린다 (%s)', async (error, message) => {
    patchPracticeGroup.mockRejectedValue(error);
    await openMenu('카페 이별 장면');
    await fireEvent.press(screen.getByText('삭제'));
    await fireEvent.press(screen.getByText('삭제'));

    expect(await screen.findByText('삭제 실패')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
  });
});

test('뒤로는 이전 화면이 있으면 돌아가고 없으면 홈으로 간다', async () => {
  await render(<HistoryScreen />);
  await screen.findByText('카페 이별 장면');

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);

  mockRouter.canGoBack.mockReturnValue(false);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import LineSearchScreen from '@/app/line-search';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { challengeCard } from '../helpers/challenge-card';

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('@/lib/api', () => ({ api: { listChallenges: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const listChallenges = api.listChallenges as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

const input = () => screen.getByPlaceholderText('대사·작품·배우 검색');

test('두 글자 전에는 찾지 않고 안내만 한다', async () => {
  await render(<LineSearchScreen />);
  expect(screen.getByText('두 글자 이상 적어 주세요.')).toBeOnTheScreen();

  await fireEvent.changeText(input(), '햄');
  await act(() => jest.advanceTimersByTime(350));

  expect(screen.getByText('두 글자 이상 적어 주세요.')).toBeOnTheScreen();
  expect(listChallenges).not.toHaveBeenCalled();
});

test('입력이 멈추면 찾고, 결과를 누르면 그 챌린지를 연다', async () => {
  listChallenges.mockResolvedValue({
    featured: null,
    challenges: [
      challengeCard({
        id: 'c7',
        line: '사느냐 죽느냐',
        entry_count: 4,
        participants: [
          { name: '윤서', user_id: 'u1' },
          { name: '태오', user_id: 'u2' },
        ],
        more_count: 2,
      }),
    ],
  });
  await render(<LineSearchScreen />);

  await fireEvent.changeText(input(), ' 햄릿 ');
  expect(await screen.findByText('“사느냐 죽느냐”')).toBeOnTheScreen();

  expect(listChallenges).toHaveBeenCalledWith({ tab: 'popular', q: '햄릿' });
  expect(screen.getByText('햄릿 · 참여작 4 · 종료')).toBeOnTheScreen();
  expect(screen.getByText('윤서 · 태오 +2')).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('line_search', { length: 2, count: 1 });

  await fireEvent.press(screen.getByText('“사느냐 죽느냐”'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenge-detail', params: { id: 'c7' } });
});

test('결과가 없으면 적은 말을 그대로 들고 직접 등록으로 간다', async () => {
  listChallenges.mockResolvedValue({ featured: null, challenges: [] });
  await render(<LineSearchScreen />);

  await fireEvent.changeText(input(), '없는 대사 ');
  await fireEvent.press(await screen.findByRole('button', { name: /찾는 대사가 없어요\? 직접 등록하기/ }));

  expect(screen.getByText('검색 결과가 없어요.')).toBeOnTheScreen();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/line-new', params: { line: '없는 대사' } });
});

test('찾지 못하면 실패 이유를 보여 주고 빈 결과 안내는 띄우지 않는다', async () => {
  listChallenges.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  await render(<LineSearchScreen />);

  await fireEvent.changeText(input(), '햄릿');

  expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
  expect(screen.queryByText('검색 결과가 없어요.')).not.toBeOnTheScreen();
});

test('지우기를 누르면 입력과 결과가 비고, 키보드 검색은 바로 찾는다', async () => {
  listChallenges.mockResolvedValue({ featured: null, challenges: [challengeCard({ line: '대사 하나' })] });
  await render(<LineSearchScreen />);

  await fireEvent.changeText(input(), '대사');
  await fireEvent(input(), 'submitEditing');
  expect(await screen.findByText('“대사 하나”')).toBeOnTheScreen();

  const [, , clear] = screen.getAllByRole('button');
  await fireEvent.press(clear);

  expect(input()).toHaveDisplayValue('');
  expect(screen.getByText('두 글자 이상 적어 주세요.')).toBeOnTheScreen();
  await waitFor(() => expect(screen.queryByText('“대사 하나”')).not.toBeOnTheScreen());
});

test('머리의 버튼으로 뒤로 가거나 빈 대사로 등록을 연다', async () => {
  await render(<LineSearchScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getAllByRole('button')[1]);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/line-new', params: { line: '' } });
});

test('다시 찾는 동안에는 빈 결과 안내를 거뒀다가 끝나면 다시 띄운다', async () => {
  let resolve!: (v: unknown) => void;
  listChallenges
    .mockResolvedValueOnce({ featured: null, challenges: [] })
    .mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await render(<LineSearchScreen />);

  await fireEvent.changeText(input(), '햄릿');
  expect(await screen.findByText('검색 결과가 없어요.')).toBeOnTheScreen();

  await fireEvent(input(), 'submitEditing');
  expect(screen.queryByText('검색 결과가 없어요.')).not.toBeOnTheScreen();

  await act(async () => resolve({ featured: null, challenges: [] }));
  expect(screen.getByText('검색 결과가 없어요.')).toBeOnTheScreen();
  expect(listChallenges).toHaveBeenCalledTimes(2);
});

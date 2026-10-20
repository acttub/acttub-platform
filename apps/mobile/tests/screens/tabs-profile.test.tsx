import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import ProfileScreen from '@/app/(tabs)/profile';
import { api } from '@/lib/api';

type Me = { profile: { name?: string | null; photo_url?: string | null; bio?: string | null } | null } | null;

const mockRouter = { push: jest.fn() };
let mockUser: { email: string | null } | null = { email: 'actor@example.com' };
let mockMe: Me = null;
let mockFocusEffect: () => (() => void) | void = () => undefined;
let mockCleanup: (() => void) | void;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => (() => void) | void) => {
      mockFocusEffect = effect;
      useEffect(() => {
        mockCleanup = effect();
        return () => mockCleanup?.();
      }, [effect]);
    },
  };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser, profile: { me: mockMe } }) }));
jest.mock('@/lib/api', () => ({ api: { listPracticeGroups: jest.fn(), listMyChallengeEntries: jest.fn() } }));

const getItem = SecureStore.getItemAsync as jest.Mock;
const listGroups = api.listPracticeGroups as jest.Mock;
const listEntries = api.listMyChallengeEntries as jest.Mock;

const entry = (challengeId: string) => ({ challenge: { id: challengeId } });

/** 다른 화면에 갔다가 프로필 탭으로 돌아온다. */
async function refocus() {
  await act(async () => {
    mockCleanup?.();
    mockCleanup = mockFocusEffect();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { email: 'actor@example.com' };
  mockMe = null;
  getItem.mockResolvedValue(null);
  listGroups.mockResolvedValue({ groups: [] });
  listEntries.mockResolvedValue({ entries: [], next_cursor: null });
});

test('서버 프로필의 이름·사진·소개와, 연습 회차 합과 참여한 서로 다른 챌린지 수를 보여 준다', async () => {
  mockMe = { profile: { name: '김배우', photo_url: 'https://cdn/photo.jpg', bio: '  무대가 좋은 배우  ' } };
  getItem.mockResolvedValue('기기 이름');
  listGroups.mockResolvedValue({ groups: [{ ordinal_count: 2 }, { ordinal_count: 3 }] });
  listEntries
    .mockResolvedValueOnce({ entries: [entry('c1'), entry('c2')], next_cursor: 'n1' })
    .mockResolvedValueOnce({ entries: [entry('c2'), entry('c3')], next_cursor: null });

  await render(<ProfileScreen />);

  expect(await screen.findByText('5')).toBeOnTheScreen();
  expect(await screen.findByText('3')).toBeOnTheScreen();
  expect(listGroups).toHaveBeenCalledWith('all');
  expect(listEntries.mock.calls).toEqual([
    [undefined, undefined],
    [undefined, 'n1'],
  ]);
  expect(screen.getByText('김배우')).toBeOnTheScreen();
  expect(screen.queryByText('기기 이름')).not.toBeOnTheScreen();
  expect(screen.getByText('actor@example.com')).toBeOnTheScreen();
  expect(screen.getByText('사진 변경')).toBeOnTheScreen();
  expect(screen.queryByText('김')).not.toBeOnTheScreen();
  expect(screen.getByText('무대가 좋은 배우')).toBeOnTheScreen();
  expect(screen.queryByText('나를 보여주는 소개를 추가해 보세요.')).not.toBeOnTheScreen();
});

test('서버 이름을 아직 못 읽었으면 기기에 적어 둔 이름과 첫 글자를 쓰고, 사진·소개는 추가하라고 안내한다', async () => {
  mockMe = { profile: { name: null, photo_url: null, bio: '   ' } };
  getItem.mockResolvedValue('  민지  ');

  await render(<ProfileScreen />);

  expect(await screen.findByText('민지')).toBeOnTheScreen();
  expect(screen.getByText('민')).toBeOnTheScreen();
  expect(screen.getByText('사진 추가')).toBeOnTheScreen();
  expect(screen.getByText('나를 보여주는 소개를 추가해 보세요.')).toBeOnTheScreen();
  expect(screen.getAllByText('0')).toHaveLength(2);
});

test('이름이 어디에도 없으면 이메일 앞부분으로 부른다', async () => {
  mockUser = { email: 'kim.actor99@example.com' };
  getItem.mockResolvedValue('   ');

  await render(<ProfileScreen />);

  expect(await screen.findByText('kim actor')).toBeOnTheScreen();
  expect(screen.getByText('k')).toBeOnTheScreen();
});

test('이름도 이메일도 없으면 화면 제목으로 부르고 이메일 줄은 비운다', async () => {
  mockUser = null;
  getItem.mockRejectedValue(new Error('keychain locked'));

  await render(<ProfileScreen />);

  await waitFor(() => expect(screen.getAllByText('프로필')).toHaveLength(2));
  expect(screen.getByText('프')).toBeOnTheScreen();
  expect(screen.queryByText(/@/)).not.toBeOnTheScreen();
});

test('횟수를 못 읽으면 0으로 둔다', async () => {
  listGroups.mockRejectedValue(new Error('down'));
  listEntries.mockRejectedValue(new Error('down'));

  await render(<ProfileScreen />);

  await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getByText('연습')).toBeOnTheScreen();
  expect(screen.getByText('챌린지')).toBeOnTheScreen();
});

test('다른 화면에서 돌아오면 다시 세고, 떠나기 전 늦게 온 응답은 새 값을 덮지 않는다', async () => {
  let resolveOldGroups: (value: unknown) => void = () => undefined;
  let resolveOldEntries: (value: unknown) => void = () => undefined;
  let resolveOldName: (value: unknown) => void = () => undefined;
  listGroups.mockImplementationOnce(() => new Promise((resolve) => (resolveOldGroups = resolve)));
  listEntries.mockImplementationOnce(() => new Promise((resolve) => (resolveOldEntries = resolve)));
  getItem.mockImplementationOnce(() => new Promise((resolve) => (resolveOldName = resolve)));

  await render(<ProfileScreen />);

  listGroups.mockResolvedValue({ groups: [{ ordinal_count: 4 }] });
  listEntries.mockResolvedValue({ entries: [entry('c1')], next_cursor: null });
  getItem.mockResolvedValue('새 이름');
  await refocus();
  expect(await screen.findByText('4')).toBeOnTheScreen();
  expect(screen.getByText('1')).toBeOnTheScreen();
  expect(screen.getByText('새 이름')).toBeOnTheScreen();

  await act(async () => {
    resolveOldGroups({ groups: [{ ordinal_count: 9 }] });
    resolveOldEntries({ entries: [entry('c1'), entry('c2')], next_cursor: 'more' });
    resolveOldName('옛 이름');
  });

  expect(screen.getByText('4')).toBeOnTheScreen();
  expect(screen.getByText('1')).toBeOnTheScreen();
  expect(screen.getByText('새 이름')).toBeOnTheScreen();
  expect(screen.queryByText('9')).not.toBeOnTheScreen();
  expect(listEntries).toHaveBeenCalledTimes(2);
});

test('각 버튼은 설정·프로필 수정·포트폴리오·활동·코치 기억 화면으로 보낸다', async () => {
  await render(<ProfileScreen />);
  await screen.findByText('actor');

  await fireEvent.press(screen.getAllByRole('button')[0]);
  await fireEvent.press(screen.getByText('사진 추가'));
  await fireEvent.press(screen.getByText('나를 보여주는 소개를 추가해 보세요.'));
  await fireEvent.press(screen.getByText('포트폴리오 편집'));
  await fireEvent.press(screen.getByText('보관한 영상 확인'));
  await fireEvent.press(screen.getByText('저장한 영상'));
  await fireEvent.press(screen.getByText('챌린지 기록'));
  await fireEvent.press(screen.getByText('코치가 기억하는 것'));

  expect(mockRouter.push.mock.calls).toEqual([
    ['/settings'],
    ['/profile-edit'],
    ['/profile-edit'],
    ['/portfolio-edit'],
    ['/archive'],
    ['/saved-videos'],
    ['/challenge-entries'],
    [{ pathname: '/memory', params: { from: 'profile' } }],
  ]);
  expect(screen.getByText('내가 올린 참여작과 공개 범위')).toBeOnTheScreen();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoachScriptsScreen from '@/app/coach-scripts';
import { takeRecordScript } from '@/lib/practice/record-script';
import { setContinueOrigin } from '@/lib/practice/session-state';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
const mockListScripts = jest.fn();
const mockGetScriptDetail = jest.fn();
const mockRemembered: Record<string, string[]> = {};
jest.mock('@/lib/reading/store', () => ({
  listScripts: () => mockListScripts(),
  getScriptDetail: (id: string) => mockGetScriptDetail(id),
  rememberedMyRoles: async (id: string) => mockRemembered[id] ?? [],
}));

const card = (id: string, title: string, roles: string[]) => ({
  id,
  title,
  my_character_names: roles,
  dialogue_count: 16,
  recording_count: 0,
  last_practiced_at: null,
  last_activity_at: '2026-10-23T00:00:00Z',
  status: 'new',
  created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
});

beforeEach(() => jest.clearAllMocks());

test('저장한 대본을 고르고 「다음」을 누르면 장면 칸을 채우고, 촬영 화면에 띄울 대본을 넘기고 카메라로 간다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [card('s1', '네가 좋아하는 케이크', ['지훈']), card('s2', '작은 상자 안의 열쇠', [])], total_count: 2, in_progress_count: 0 });
  mockGetScriptDetail.mockResolvedValue({
    id: 's1',
    title: '네가 좋아하는 케이크',
    characters: [{ id: 'c1', name: '지훈' }, { id: 'c2', name: '수아' }],
    lines: [
      { id: 'l1', kind: 'scene', character_id: null, text: '카페 앞 골목, 저녁' },
      { id: 'l2', kind: 'dialogue', character_id: 'c1', text: '이 딸기케이크 주려고 잠깐 들른 거야.' },
      { id: 'l3', kind: 'dialogue', character_id: 'c2', text: '여기까진 왜 왔어.' },
    ],
    scenes: [],
  });
  await render(<CoachScriptsScreen />);

  expect(await screen.findByText('어떤 대본으로 찍을까요?')).toBeOnTheScreen();
  expect(screen.getByText('대사 16개 · 지훈')).toBeOnTheScreen();
  expect(screen.getByText('대사 16개 · 배역 안 고름')).toBeOnTheScreen();
  // 첫 대본을 미리 골라 둬 「다음」이 처음부터 켜져 있다(UX 가이드 5절, 10/28).
  expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();

  await fireEvent.press(screen.getByText('네가 좋아하는 케이크'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } }));
  expect(mockGetScriptDetail).toHaveBeenCalledWith('s1');
  expect(setContinueOrigin).toHaveBeenCalledWith({
    kind: 'reading',
    scene: { situation: '네가 좋아하는 케이크', character: '지훈', goal: '' },
  });
  expect(takeRecordScript()).toEqual({
    title: '네가 좋아하는 케이크',
    lines: [
      { kind: 'scene', speaker: null, text: '카페 앞 골목, 저녁', mine: false },
      { kind: 'dialogue', speaker: '지훈', text: '이 딸기케이크 주려고 잠깐 들른 거야.', mine: true },
      { kind: 'dialogue', speaker: '수아', text: '여기까진 왜 왔어.', mine: false },
    ],
  });
});

test('리딩 회차가 없어 서버 배역이 비면 대본 만들기 때 기억한 내 배역을 보인다', async () => {
  mockRemembered.s2 = ['민수'];
  mockListScripts.mockResolvedValue({ scripts: [card('s2', '작은 상자 안의 열쇠', [])], total_count: 1, in_progress_count: 0 });
  await render(<CoachScriptsScreen />);
  expect(await screen.findByText('대사 16개 · 민수')).toBeOnTheScreen();
  delete mockRemembered.s2;
});

test('저장한 대본이 없으면 대본 같이 만들기로 보낸다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
  await render(<CoachScriptsScreen />);

  expect(await screen.findByText('아직 저장한 대본이 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '새 대본 같이 만들기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/script-cocreate');
});

test('대본을 여는 동안 「다음」은 「여는 중…」으로 바뀐다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [card('s1', '네가 좋아하는 케이크', ['지훈'])], total_count: 1, in_progress_count: 0 });
  mockGetScriptDetail.mockReturnValue(new Promise(() => undefined));
  await render(<CoachScriptsScreen />);

  await fireEvent.press(await screen.findByText('네가 좋아하는 케이크'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('여는 중…')).toBeOnTheScreen();
  // 「새 대본 같이 만들기」는 주 버튼 위의 글자 버튼이다.
  await fireEvent.press(screen.getByRole('button', { name: '새 대본 같이 만들기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/script-cocreate');
});

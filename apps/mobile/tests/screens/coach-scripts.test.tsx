import { fireEvent, render, screen } from '@testing-library/react-native';

import CoachScriptsScreen from '@/app/coach-scripts';
import { setContinueOrigin } from '@/lib/practice/session-state';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
const mockListScripts = jest.fn();
jest.mock('@/lib/reading/store', () => ({ listScripts: () => mockListScripts() }));

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

test('저장한 대본을 고르고 「다음」을 누르면 제목·내 배역을 장면 칸에 채워 카메라로 간다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [card('s1', '네가 좋아하는 케이크', ['지훈']), card('s2', '작은 상자 안의 열쇠', [])], total_count: 2, in_progress_count: 0 });
  await render(<CoachScriptsScreen />);

  expect(await screen.findByText('어떤 대본으로 찍을까요?')).toBeOnTheScreen();
  expect(screen.getByText('대사 16개 · 지훈')).toBeOnTheScreen();
  expect(screen.getByText('대사 16개 · 배역 안 고름')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();

  await fireEvent.press(screen.getByText('네가 좋아하는 케이크'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({
    kind: 'reading',
    scene: { situation: '네가 좋아하는 케이크', character: '지훈', goal: '' },
  });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } });
});

test('저장한 대본이 없으면 대본 같이 만들기로 보낸다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
  await render(<CoachScriptsScreen />);

  expect(await screen.findByText('아직 저장한 대본이 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '새 대본 같이 만들기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/script-cocreate');
});

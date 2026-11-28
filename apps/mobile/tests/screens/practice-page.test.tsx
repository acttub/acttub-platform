import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import PracticePage from '@/components/practice/reading-pane';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { startSceneCoaching } from '@/hooks/scene-coaching';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { hasSeenReadingTutorial, hasSeenSpotlight } from '@/lib/guide-state';
import { takeRecordScript } from '@/lib/practice/record-script';
import { getScriptDetail, listScripts, listSessions, loadIntoCurrent } from '@/lib/reading/store';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';
import type { ScriptCard } from '@/lib/reading/types';

/**
 * 연습 탭 한 페이지(시안 B3 + 촬영 단계) — 단계 칸 셋, 「다음 할 일」 카드의 단계별 글·버튼, 대본 줄의 다음 할 일, 코칭 구역, 첫 사용자.
 * 리딩 목록 자체(검색·더보기·입구 뼈대 등)는 tests/screens/tabs-reading.test.tsx 가 본다.
 */
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getScriptImport: jest.fn(), listPracticeGroups: jest.fn(), getPracticeNote: jest.fn(), getPracticeJournal: jest.fn() },
}));
jest.mock('@/lib/reading/store', () => ({
  listScripts: jest.fn(),
  deleteScript: jest.fn(),
  loadIntoCurrent: jest.fn(),
  updateScriptMeta: jest.fn(),
  listSessions: jest.fn(async () => []),
  fetchSession: jest.fn(),
  setCurrentSession: jest.fn(),
  getScriptDetail: jest.fn(),
  rememberedMyRoles: jest.fn(async () => []),
}));
jest.mock('@/lib/guide-state', () => ({
  hasSeenReadingTutorial: jest.fn(),
  hasSeenSpotlight: jest.fn(),
  markReadingTutorialSeen: jest.fn(async () => undefined),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
}));
jest.mock('@/hooks/use-cloud-voice', () => ({ useCloudVoice: jest.fn() }));
jest.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ count: 0, badge: null }) }));
jest.mock('@/hooks/use-waiting-upload', () => ({ useWaitingUpload: () => ({ card: null, error: null, busy: false, retry: jest.fn(), begin: jest.fn() }) }));
jest.mock('@/hooks/scene-coaching', () => ({ startSceneCoaching: jest.fn(async () => undefined) }));
jest.mock('@/components/ad-slot', () => ({ AdSlot: () => null }));
// 이 기기의 ②③ 기록 — 저장소 대신 시험이 정한다. 판정(practiceStepOf 등)은 실제 코드.
let mockTakes: Record<string, { takenAt?: number; coachedAt?: number; pendingId?: string }> = {};
jest.mock('@/lib/practice/scene-takes', () => ({
  ...jest.requireActual('@/lib/practice/scene-takes'),
  knownSceneTakes: () => null,
  loadSceneTakes: async () => mockTakes,
}));

const T = Date.parse('2026-11-20T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
function card(overrides: Partial<ScriptCard>): ScriptCard {
  return {
    id: 's1',
    title: '옥상 장면',
    my_character_names: ['민지'],
    dialogue_count: 12,
    recording_count: 3,
    last_practiced_at: iso(T),
    last_activity_at: iso(T),
    status: 'completed',
    created_at: iso(T),
    updated_at: iso(T),
    ...overrides,
  };
}
const rooftop = card({});
const cafe = card({ id: 's2', title: '카페 장면', my_character_names: [], status: 'no_cast', last_practiced_at: null });
const noted = (id: string): PracticeRound =>
  ({ id, ordinal: 1, created_at: iso(T + 5000), stage: 'done', message_count: 4, note: { id: `n-${id}`, title: '노트', kind: 'action' }, conversation_id: null, previous_conversations: [] }) as unknown as PracticeRound;
const coachedGroup = (title: string): PracticeGroup => ({
  root_id: 'g1',
  title,
  ordinal_count: 1,
  in_progress_practice_id: null,
  favorite: false,
  hidden_at: null,
  last_practiced_at: iso(T + 5000),
  poster_url: null,
  practices: [noted('p1')],
});

const voice = { status: null, enabled: false, busy: false, enable: jest.fn(), disable: jest.fn(), refresh: jest.fn(async () => null), consentSheet: null };
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);

beforeEach(() => {
  jest.clearAllMocks();
  mockTakes = {};
  (useCloudVoice as jest.Mock).mockImplementation(() => voice);
  (listScripts as jest.Mock).mockResolvedValue({ scripts: [rooftop, cafe], total_count: 2, in_progress_count: 0 });
  (listSessions as jest.Mock).mockResolvedValue([{ id: 'r0', status: 'completed', progress: null }, { id: 'r1', status: 'completed', progress: null }]);
  (hasSeenReadingTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
  (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [] });
  (api.getPracticeNote as jest.Mock).mockResolvedValue({ next_take: null, report: null });
  (api.getPracticeJournal as jest.Mock).mockRejectedValue(new Error('none'));
});

describe('단계 칸', () => {
  test('① 대사 익히기 · ② 촬영하기 · ③ 코칭 받기를 보이고, 누르면 새 대본·찍을 대본 고르기·코칭 시작으로 간다', async () => {
    await render(<PracticePage />);
    await screen.findByText('옥상 장면');
    expect(screen.getByText('① 대사 익히기')).toBeOnTheScreen();
    expect(screen.getByText('② 촬영하기')).toBeOnTheScreen();
    expect(screen.getByText('③ 코칭 받기')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '1단계 대사 익히기, 대본 리딩' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/reading/new');
    await fireEvent.press(screen.getByRole('button', { name: '2단계 촬영하기, 대본 보며 찍기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach-scripts', params: { purpose: 'scene' } });
    // 코칭을 한 번도 안 했으면 목적을 묻지 않는 첫 코칭.
    await fireEvent.press(screen.getByRole('button', { name: '3단계 코칭 받기, 영상 또는 말로' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: { first: '1' } });
    expect(logged('practice_step_tap')).toEqual([{ step: 'read' }, { step: 'shoot' }, { step: 'coach' }]);
  });

  test('코칭한 적이 있으면 ③은 새 연습 준비로 간다', async () => {
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [coachedGroup('다른 장면')] });
    await render(<PracticePage />);
    await screen.findByText('최근 코칭');
    await fireEvent.press(screen.getByRole('button', { name: '3단계 코칭 받기, 영상 또는 말로' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
  });
});

describe('다음 할 일 카드', () => {
  test('리딩을 끝냈고 아직 안 찍었으면 「리딩 n번 했어요 · 이 장면 찍기」 — 누르면 그 대본으로 장면 촬영을 연다', async () => {
    (getScriptDetail as jest.Mock).mockResolvedValue({
      id: 's1',
      title: '옥상 장면',
      characters: [{ id: 'c1', name: '민지' }],
      lines: [{ id: 'l1', kind: 'dialogue', character_id: 'c1', text: '여기 바람 좋다.' }],
      scenes: [],
    });
    await render(<PracticePage />);
    const next = await screen.findByTestId('practice-next-read');
    expect(within(next).getByText('리딩 2번 했어요')).toBeOnTheScreen();
    expect(within(next).getByText('이제 이 장면을 찍어 볼 차례예요')).toBeOnTheScreen();
    expect(within(next).getByText('옥상 장면 · 민지')).toBeOnTheScreen();

    await fireEvent.press(next);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'scene', from: 'card' } }));
    expect(takeRecordScript()).toMatchObject({ scriptId: 's1', role: '민지' });
    expect(logged('practice_next_tap')).toEqual([{ action: 'shoot' }]);
  });

  test('찍었고 코칭 전이면 「코치에게 보여 주기」 — 누르면 그 영상으로 코칭을 시작한다', async () => {
    mockTakes = { s1: { takenAt: T + 1000, pendingId: 'pend1' } };
    await render(<PracticePage />);
    const next = await screen.findByTestId('practice-next-shot');
    expect(within(next).getByText('찍은 영상을 코치에게 보여 줄 차례예요')).toBeOnTheScreen();
    await fireEvent.press(next);
    expect(startSceneCoaching).toHaveBeenCalledWith(mockRouter, null, { id: 's1', title: '옥상 장면', roles: ['민지'] }, mockTakes.s1);
    expect(logged('practice_next_tap')).toEqual([{ action: 'coach' }]);
  });

  test('코칭까지 받았으면 그 묶음의 코치 메모 한 줄과 「메모대로 다시 읽기」 — 누르면 대본 상세', async () => {
    mockTakes = { s1: { takenAt: T + 1000, coachedAt: T + 2000 } };
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [coachedGroup('옥상 장면')] });
    (api.getPracticeNote as jest.Mock).mockResolvedValue({ next_take: '다음엔 숨을 한 번 쉬고 말해 봐요.', report: null });
    (loadIntoCurrent as jest.Mock).mockResolvedValue({ id: 's1' });
    await render(<PracticePage />);
    const next = await screen.findByTestId('practice-next-coached');
    expect(await within(next).findByText('코치 메모: 다음엔 숨을 한 번 쉬고 말해 봐요.')).toBeOnTheScreen();
    expect(within(next).getByText('메모대로 다시 읽기')).toBeOnTheScreen();
    expect(screen.getByTestId('practice-row-status-s1')).toHaveTextContent('코치 메모: 다음엔 숨을 한 번 쉬고 말해 봐요.');
    await fireEvent.press(next);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/reading/detail'));
  });

  test('코치 메모를 못 찾으면 그 줄 없이 「다시 읽기」', async () => {
    mockTakes = { s1: { coachedAt: T + 2000 } };
    await render(<PracticePage />);
    const next = await screen.findByTestId('practice-next-coached');
    expect(within(next).getByText('다시 읽기')).toBeOnTheScreen();
    expect(within(next).queryByText(/코치 메모/)).not.toBeOnTheScreen();
  });

  test('리딩 중이면 지금과 같은 「이어서 읽기」 카드 — 알약만 「대사 익히는 중」', async () => {
    (listScripts as jest.Mock).mockResolvedValue({ scripts: [card({ status: 'reading' })], total_count: 1, in_progress_count: 1 });
    (listSessions as jest.Mock).mockResolvedValue([{ id: 'r1', status: 'in_progress', progress: { done: 3, total: 9 } }]);
    await render(<PracticePage />);
    const next = await screen.findByTestId('practice-next-reading');
    expect(within(next).getByText('대사 익히는 중')).toBeOnTheScreen();
    expect(within(next).getByText('옥상 장면 · 민지\n대사 3/9개에서 멈췄어요')).toBeOnTheScreen();
    expect(within(next).getByText('이어서 읽기')).toBeOnTheScreen();
  });

  test('첫 사용자(대본 없음)는 카드 없이 지금 리딩 첫 화면의 입구 그대로', async () => {
    (listScripts as jest.Mock).mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
    await render(<PracticePage />);
    expect(await screen.findByText('내 대본 올리기')).toBeOnTheScreen();
    expect(screen.queryByTestId(/^practice-next-/)).not.toBeOnTheScreen();
    expect(screen.getByText('① 대사 익히기')).toBeOnTheScreen();
  });
});

describe('대본 줄의 다음 할 일', () => {
  test('줄마다 상태 한 줄과 글자 버튼 하나 — 새 대본은 둘 다 없다', async () => {
    (listScripts as jest.Mock).mockResolvedValue({
      scripts: [rooftop, card({ id: 's4', title: '버스 장면', last_practiced_at: iso(T - 9000) }), cafe],
      total_count: 3,
      in_progress_count: 0,
    });
    mockTakes = { s4: { takenAt: T - 5000, pendingId: 'p4' } };
    await render(<PracticePage />);
    await screen.findByTestId('practice-next-read');

    expect(screen.getByTestId('practice-row-status-s1')).toHaveTextContent('리딩 끝 · 찍을 차례');
    expect(screen.getByTestId('practice-row-status-s4')).toHaveTextContent('찍었어요 · 코칭 받을 차례');
    expect(screen.queryByTestId('practice-row-status-s2')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '코칭 받기' })).toBeOnTheScreen();
    // 카드 버튼과 옥상 장면 줄의 글자 버튼.
    expect(screen.getAllByRole('button', { name: '이 장면 찍기' })).toHaveLength(2);

    await fireEvent.press(screen.getByRole('button', { name: '코칭 받기' }));
    expect(startSceneCoaching).toHaveBeenCalledWith(mockRouter, null, expect.objectContaining({ id: 's4' }), mockTakes.s4);
    expect(logged('practice_next_tap')).toEqual([{ action: 'coach' }]);
  });

  test('줄의 「이 장면 찍기」는 배역을 모르면 대본 상세로 보내 배역부터 고르게 한다', async () => {
    (listScripts as jest.Mock).mockResolvedValue({ scripts: [card({ my_character_names: [] })], total_count: 1, in_progress_count: 0 });
    (loadIntoCurrent as jest.Mock).mockResolvedValue({ id: 's1' });
    await render(<PracticePage />);
    await screen.findByTestId('practice-row-status-s1');
    // [0]은 카드, [1]이 줄의 글자 버튼이다.
    await fireEvent.press(screen.getAllByRole('button', { name: '이 장면 찍기' })[1]);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/reading/detail'));
    expect(getScriptDetail).not.toHaveBeenCalled();
    expect(logged('practice_next_tap')).toEqual([{ action: 'shoot' }]);
  });
});

test('최근 코칭 구역 — 내 대본 아래에 메모 카드·다른 방법·최근 코칭과 연습 기록 바로가기', async () => {
  (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [coachedGroup('다른 장면')] });
  await render(<PracticePage />);
  expect(await screen.findByText('최근 코칭')).toBeOnTheScreen();
  expect(screen.getByText('저번 코치 메모')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다른 방법으로 코칭 받기' })).toBeOnTheScreen();
  const hosts = screen.container.queryAll((node) => typeof node.type === 'string');
  const at = (el: unknown) => hosts.indexOf(el as (typeof hosts)[number]);
  expect(at(screen.getByText('업로드한 대본'))).toBeLessThan(at(screen.getByText('최근 코칭')));
  await fireEvent.press(screen.getByRole('button', { name: '지난 코칭 다시 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
});

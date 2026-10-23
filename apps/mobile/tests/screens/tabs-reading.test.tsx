import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReadingList from '@/app/(tabs)/reading';
import { setFirstTimeState } from '@/lib/practice/first-time';
import { SpotlightHost } from '@/components/spotlight-guide';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { ApiError } from '@/lib/api-request';
import { hasSeenReadingTutorial, hasSeenSpotlight, markReadingTutorialSeen, markSpotlightSeen } from '@/lib/guide-state';
import { deleteScript, listScripts, loadIntoCurrent, updateScriptMeta } from '@/lib/reading/store';
import type { ScriptCard } from '@/lib/reading/types';
import { currentTutorial, endTutorial, startTutorial } from '@/lib/tutorial';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockFocusEffect: () => void | (() => void) = () => undefined;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/reading/store', () => ({
  listScripts: jest.fn(),
  deleteScript: jest.fn(),
  loadIntoCurrent: jest.fn(),
  updateScriptMeta: jest.fn(),
  listSessions: jest.fn(async () => []),
  fetchSession: jest.fn(),
  setCurrentSession: jest.fn(),
}));
jest.mock('@/lib/guide-state', () => ({
  hasSeenReadingTutorial: jest.fn(),
  hasSeenSpotlight: jest.fn(),
  markReadingTutorialSeen: jest.fn(async () => undefined),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
}));
jest.mock('@/hooks/use-cloud-voice', () => ({ useCloudVoice: jest.fn() }));

const voice = {
  status: null as null | { available: boolean; consent: string; free_until: string | null },
  enabled: false,
  busy: false,
  enable: jest.fn(async () => true),
  disable: jest.fn(async () => undefined),
  refresh: jest.fn(async () => null),
  consentSheet: null,
};

const now = new Date();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();

function card(overrides: Partial<ScriptCard>): ScriptCard {
  return {
    id: 's1',
    title: '옥상 장면',
    my_character_names: ['민지'],
    dialogue_count: 12,
    recording_count: 3,
    last_practiced_at: yesterday,
    last_activity_at: yesterday,
    status: 'reading',
    created_at: yesterday,
    updated_at: yesterday,
    ...overrides,
  };
}

const rooftop = card({});
const cafe = card({
  id: 's2',
  title: '카페 장면',
  my_character_names: [],
  status: 'no_cast',
  last_practiced_at: null,
  last_activity_at: '2026-05-25T03:00:00Z',
});
const done = card({ id: 's3', title: '끝난 장면', status: 'completed', last_activity_at: 'not-a-date' });

beforeEach(() => {
  jest.clearAllMocks();
  endTutorial();
  Object.assign(voice, { status: null, enabled: false, busy: false });
  (useCloudVoice as jest.Mock).mockImplementation(() => voice);
  (listScripts as jest.Mock).mockResolvedValue({ scripts: [rooftop, cafe, done], total_count: 3, in_progress_count: 1 });
  (hasSeenReadingTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
});

test('대본 카드마다 배역·대사 수·상태를 보여 준다', async () => {
  await render(<ReadingList />);

  expect(await screen.findByText('옥상 장면')).toBeOnTheScreen();
  expect(listScripts).toHaveBeenCalledWith('');
  expect(voice.refresh).toHaveBeenCalled();
  expect(screen.getByText('업로드한 대본')).toBeOnTheScreen();
  expect(screen.getByText('전체 3개')).toBeOnTheScreen();
  expect(screen.getByText('민지 · 대사 12개 · 연습 중')).toBeOnTheScreen();
  expect(screen.getByText('배역 미선택 · 대사 12개')).toBeOnTheScreen();
  expect(screen.getByText('민지 · 대사 12개 · 연습 완료')).toBeOnTheScreen();
  expect(screen.queryByText('고품질 AI 목소리로 리딩해요')).not.toBeOnTheScreen();
});

test('대본이 없으면 새 대본으로 시작하라고 안내한다', async () => {
  (listScripts as jest.Mock).mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
  await render(<ReadingList />);

  expect(await screen.findByText('대사를 같이 맞춰 읽어 볼까요?')).toBeOnTheScreen();
  expect(screen.queryByText('업로드한 대본')).not.toBeOnTheScreen();
  expect(screen.queryByText('새 대본')).not.toBeOnTheScreen();
  // 고르기만 하면 넘어가지 않는다 — 「다음」을 눌러야 간다.
  await fireEvent.press(screen.getByText('내 대본 올리기'));
  expect(mockRouter.push).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/new');
  // 대본이 없어도 — 예시 대본으로 채운 대본 넣기 화면(pen 「대본 탭」).
  expect(screen.getByText('짧은 예시 대본으로 바로 읽어 봐요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('예시 대본으로 하기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/reading/new', params: { sample: '1' } });
  expect(screen.getByRole('header', { name: '리딩' })).toBeOnTheScreen();
});

test('새 대본 버튼에서 업로드와 같이 만들기를 고른다', async () => {
  await render(<ReadingList />);
  await screen.findByText('옥상 장면');
  await fireEvent.press(screen.getByText('새 대본'));
  await fireEvent.press(await screen.findByText('내 대본 올리기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/new');
});

test('검색어는 잠깐 기다렸다가 서버에 묻고, 맞는 대본이 없으면 그렇게 말한다', async () => {
  await render(<ReadingList />);
  await screen.findByText('옥상 장면');
  (listScripts as jest.Mock).mockResolvedValue({ scripts: [], total_count: 3, in_progress_count: 1 });

  await fireEvent.press(screen.getByLabelText('검색'));
  await fireEvent.changeText(screen.getByPlaceholderText('작품명 또는 배역 검색'), '햄릿');
  expect(listScripts).toHaveBeenCalledTimes(1);

  expect(await screen.findByText('검색 결과가 없어요.')).toBeOnTheScreen();
  expect(listScripts).toHaveBeenLastCalledWith('햄릿');
  expect(screen.getByText('업로드한 대본')).toBeOnTheScreen();
  expect(screen.queryByText('대사를 같이 맞춰 읽어 볼까요?')).not.toBeOnTheScreen();
});

test('늦게 온 이전 검색 결과는 버린다', async () => {
  let resolveFirst: (v: unknown) => void = () => undefined;
  (listScripts as jest.Mock)
    .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
    .mockResolvedValueOnce({ scripts: [cafe], total_count: 1, in_progress_count: 0 });
  await render(<ReadingList />);
  await fireEvent.press(screen.getByLabelText('검색'));
  await fireEvent.changeText(screen.getByPlaceholderText('작품명 또는 배역 검색'), '카페');

  expect(await screen.findByText('카페 장면')).toBeOnTheScreen();
  await act(async () => resolveFirst({ scripts: [rooftop], total_count: 1, in_progress_count: 1 }));
  expect(screen.queryByText('옥상 장면')).not.toBeOnTheScreen();
});

test('늦게 실패한 이전 요청은 오류로 덮지 않는다', async () => {
  let rejectFirst: (e: unknown) => void = () => undefined;
  (listScripts as jest.Mock)
    .mockReturnValueOnce(new Promise((_, reject) => (rejectFirst = reject)))
    .mockResolvedValueOnce({ scripts: [cafe], total_count: 1, in_progress_count: 0 });
  await render(<ReadingList />);
  await fireEvent.press(screen.getByLabelText('검색'));
  await fireEvent.changeText(screen.getByPlaceholderText('작품명 또는 배역 검색'), '카페');

  expect(await screen.findByText('카페 장면')).toBeOnTheScreen();
  await act(async () => rejectFirst(new Error('down')));
  expect(screen.queryByText('대본 목록을 불러오지 못했어요')).not.toBeOnTheScreen();
});

test('목록을 못 불러오면 다시 시도할 수 있다', async () => {
  (listScripts as jest.Mock).mockRejectedValueOnce(new ApiError(503, '서버 오류'));
  await render(<ReadingList />);

  expect(await screen.findByText('대본 목록을 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));

  expect(await screen.findByText('옥상 장면')).toBeOnTheScreen();
  expect(screen.queryByText('대본 목록을 불러오지 못했어요')).not.toBeOnTheScreen();
});

test('화면을 떠나면 진행 중이던 응답을 버린다', async () => {
  let resolve: (v: unknown) => void = () => undefined;
  (listScripts as jest.Mock).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const view = await render(<ReadingList />);
  await view.unmount();
  await act(async () => resolve({ scripts: [rooftop], total_count: 1, in_progress_count: 1 }));
  expect(screen.queryByText('옥상 장면')).not.toBeOnTheScreen();
});

describe('카드 누르기', () => {
  test('대본을 불러오면 상세로 간다', async () => {
    (loadIntoCurrent as jest.Mock).mockResolvedValue(true);
    await render(<ReadingList />);
    await fireEvent.press(await screen.findByText('옥상 장면'));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/reading/detail'));
    expect(loadIntoCurrent).toHaveBeenCalledWith('s1');
  });

  test('대본이 사라졌으면 목록을 다시 읽는다', async () => {
    (loadIntoCurrent as jest.Mock).mockResolvedValue(false);
    await render(<ReadingList />);
    await fireEvent.press(await screen.findByText('옥상 장면'));

    await waitFor(() => expect(listScripts).toHaveBeenCalledTimes(2));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('더보기 메뉴', () => {
  async function openMore(index: number) {
    await render(<ReadingList />);
    await screen.findByText('옥상 장면');
    await fireEvent.press(screen.getAllByLabelText('더보기')[index]);
  }

  test('길게 눌러도 같은 메뉴가 뜬다', async () => {
    await render(<ReadingList />);
    await fireEvent(await screen.findByText('카페 장면'), 'longPress');
    expect(screen.getByText('제목 수정')).toBeOnTheScreen();
    expect(screen.getAllByText('카페 장면')).toHaveLength(2);
  });

  test('삭제를 확인하면 지우고 목록을 다시 읽는다', async () => {
    (deleteScript as jest.Mock).mockResolvedValue(undefined);
    await openMore(0);
    await fireEvent.press(screen.getByText('대본 삭제'));
    expect(screen.getByText('녹음과 연습 기록이 함께 지워지고 되돌릴 수 없어요.')).toBeOnTheScreen();
    (listScripts as jest.Mock).mockResolvedValue({ scripts: [cafe], total_count: 1, in_progress_count: 0 });
    await fireEvent.press(screen.getByText('삭제'));

    await waitFor(() => expect(screen.queryByText('옥상 장면')).not.toBeOnTheScreen());
    expect(deleteScript).toHaveBeenCalledWith('s1');
  });

  test('삭제를 취소하면 지우지 않는다', async () => {
    await openMore(0);
    await fireEvent.press(screen.getByText('대본 삭제'));
    await fireEvent.press(screen.getByText('취소'));
    expect(deleteScript).not.toHaveBeenCalled();
  });

  test('삭제가 실패하면 까닭을 알리고 목록을 다시 읽는다', async () => {
    (deleteScript as jest.Mock).mockRejectedValue(new Error('이미 지워진 대본이에요'));
    await openMore(0);
    await fireEvent.press(screen.getByText('대본 삭제'));
    await fireEvent.press(screen.getByText('삭제'));

    expect(await screen.findByText('이미 지워진 대본이에요')).toBeOnTheScreen();
    expect(listScripts).toHaveBeenCalledTimes(2);
  });

  test('제목 수정에서 저장하면 목록을 다시 읽는다', async () => {
    (updateScriptMeta as jest.Mock).mockResolvedValue(undefined);
    await openMore(1);
    await fireEvent.press(screen.getByText('제목 수정'));
    const input = screen.getByDisplayValue('카페 장면');
    await fireEvent.changeText(input, '카페 이별');
    await fireEvent.press(screen.getByText('저장'));

    await waitFor(() => expect(listScripts).toHaveBeenCalledTimes(2));
    expect(updateScriptMeta).toHaveBeenCalledWith('s2', { title: '카페 이별' });
  });

  test('제목 수정을 그냥 닫으면 다시 읽지 않는다', async () => {
    await openMore(1);
    await fireEvent.press(screen.getByText('제목 수정'));
    await fireEvent.press(screen.getByText('취소'));

    expect(screen.queryByDisplayValue('카페 장면')).not.toBeOnTheScreen();
    expect(listScripts).toHaveBeenCalledTimes(1);
  });
});

describe('고품질 목소리 띠', () => {
  test('쓸 수 있으면 무료 기한과 함께 보이고, 켜면 동의 흐름으로 간다', async () => {
    voice.status = { available: true, consent: 'none', free_until: '2026-12-31T03:00:00Z' };
    await render(<ReadingList />);

    expect(await screen.findByText('고품질 AI 목소리로 리딩해요')).toBeOnTheScreen();
    expect(screen.getByText('12월 31일까지 무료')).toBeOnTheScreen();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveProp('value', false);

    await fireEvent(toggle, 'valueChange', true);
    expect(voice.enable).toHaveBeenCalledWith('settings');
  });

  test('동의하고 켠 상태면 스위치가 켜져 있고, 끄면 끈다', async () => {
    voice.status = { available: true, consent: 'granted', free_until: null };
    voice.enabled = true;
    await render(<ReadingList />);

    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveProp('value', true);
    expect(screen.queryByText(/까지 무료/)).not.toBeOnTheScreen();
    await fireEvent(toggle, 'valueChange', false);
    expect(voice.disable).toHaveBeenCalled();
  });

  test('목소리 상태를 다시 못 읽어도 목록은 뜬다', async () => {
    voice.refresh.mockRejectedValueOnce(new Error('down'));
    await render(<ReadingList />);
    expect(await screen.findByText('옥상 장면')).toBeOnTheScreen();
  });
});

describe('처음 온 사람', () => {
  const withHost = (
    <>
      <ReadingList />
      <SpotlightHost />
    </>
  );

  test('예전 「리딩 한 바퀴」 시트는 띄우지 않고 본 것으로 적은 뒤 새 대본 안내를 띄운다(SOMA-748)', async () => {
    (hasSeenReadingTutorial as jest.Mock).mockResolvedValue(false);
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    expect(await screen.findByText('대본을 넣어 보세요')).toBeOnTheScreen();
    expect(screen.queryByText('대본 리딩 한 바퀴 해볼까요?')).not.toBeOnTheScreen();
    expect(markReadingTutorialSeen).toHaveBeenCalled();
    expect(hasSeenSpotlight).toHaveBeenCalledWith('reading');
  });

  test('튜토리얼을 본 사람에게는 새 대본 안내만 한 번 띄우고, 닫으면 본 것으로 적는다', async () => {
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    expect(await screen.findByText('대본을 넣어 보세요')).toBeOnTheScreen();
    expect(screen.queryByText('대본 리딩 한 바퀴 해볼까요?')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('알겠어요'));
    await waitFor(() => expect(markSpotlightSeen).toHaveBeenCalledWith('reading'));
    expect(screen.queryByText('대본을 넣어 보세요')).not.toBeOnTheScreen();
  });

  test('리딩 튜토리얼 중에 목록으로 돌아오면 튜토리얼을 끝낸다', async () => {
    startTutorial('own', 'reading');
    await render(<ReadingList />);
    await screen.findByText('옥상 장면');
    expect(currentTutorial()).toBeNull();

    startTutorial('own', 'practice');
    await act(async () => void mockFocusEffect());
    expect(currentTutorial()).toEqual({ mode: 'own', track: 'practice' });
  });
});

describe('첫 사용자라 탭바가 숨으면', () => {
  afterEach(() => setFirstTimeState('unknown'));

  test('머리에 홈으로 돌아가는 꺾쇠를 둔다', async () => {
    setFirstTimeState('first');
    await render(<ReadingList />);
    await screen.findByText('옥상 장면');

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back.props['ph-label']).toBe('reading_back_home');
    await fireEvent.press(back);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/');
  });

  test('머리 오른쪽에 설정 버튼을 둔다 — 탭바가 없어도 로그아웃·탈퇴로 갈 수 있다', async () => {
    setFirstTimeState('first');
    await render(<ReadingList />);
    await screen.findByText('옥상 장면');

    const gear = screen.getByRole('button', { name: '설정' });
    expect(gear.props['ph-label']).toBe('reading_first_settings');
    await fireEvent.press(gear);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  test('탭바가 보이면(연습했거나 아직 모르면) 꺾쇠를 두지 않는다', async () => {
    setFirstTimeState('practiced');
    await render(<ReadingList />);
    await screen.findByText('옥상 장면');
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();

    await act(async () => setFirstTimeState('unknown'));
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();
  });
});

test('빈 목록에서도 대본 같이 만들기는 리딩 모드로 열린다', async () => {
  (listScripts as jest.Mock).mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
  await render(<ReadingList />);
  await fireEvent.press(await screen.findByText('대본 만들기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/script-cocreate', params: { mode: 'reading' } });
});

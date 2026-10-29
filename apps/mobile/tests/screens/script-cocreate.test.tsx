import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ScriptCocreateScreen from '@/app/script-cocreate';
import { ScriptCocreateEntry } from '@/components/script-cocreate-entry';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { SampleScript } from '@/lib/script-cocreate';

const mockParams: { mode?: string; start?: string } = {};
const mockRouter = { dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, Stack: { Screen: () => null } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn(), useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    profile: { me: { profile: { experience: 'exam_prep', age: 19, gender: 'male', goal: 'audition' } } },
  }),
}));
jest.mock('@/lib/api', () => ({
  api: {
    createSampleScript: jest.fn(),
    getSampleScript: jest.fn(),
    reviseSampleScript: jest.fn(),
    restoreSampleScript: jest.fn(),
    saveSampleScript: jest.fn(),
  },
}));
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn(), rememberMyRoles: jest.fn(async () => undefined) }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));

const createSampleScript = api.createSampleScript as jest.Mock;
const reviseSampleScript = api.reviseSampleScript as jest.Mock;
const restoreSampleScript = api.restoreSampleScript as jest.Mock;
const saveSampleScript = api.saveSampleScript as jest.Mock;

function sample(overrides: Partial<SampleScript> = {}): SampleScript {
  return {
    id: 's1',
    version: 1,
    version_count: 1,
    title: '잠긴 서랍',
    scene: '거실, 밤',
    characters: [{ name: '도윤', gender: 'm', age_band: 'young', mine: true }],
    lines: [
      { kind: 'scene', character: null, text: '거실, 밤' },
      { kind: 'dialogue', character: '도윤', text: '휴지통에 있는 거, 내 원서 맞죠.' },
      { kind: 'direction', character: null, text: '아버지가 등을 돌린다' },
    ],
    design: { relation: '아버지와 아들, 존댓말', incident: '아버지가 원서를 버렸다', prop: '열쇠', my_objective: '원서를 돌려받는다', other_reason: '', turn_action: '' },
    emotion: '분노',
    situation: '아버지가 내 원서를 버렸어요',
    character_count: 1,
    length_minutes: 1,
    estimated_seconds: 58,
    revisions_used: 0,
    revisions_left: 3,
    note: null,
    script_id: null,
    created_at: '2026-10-22T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.mode;
  delete mockParams.start;
  (api.getSampleScript as jest.Mock).mockResolvedValue(sample());
});

async function reachDirection(rendered = false) {
  if (!rendered) await render(<ScriptCocreateScreen />);
  expect(screen.getByText('어떤 감정을 연기해 볼래요?')).toBeOnTheScreen();
  // pen P14.1 — 감정은 고르기만 하고 「다음」을 눌러야 상황으로 간다. 고르기 전에는 「다음」이 막혀 있다.
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  await fireEvent.press(screen.getByText('분노'));
  expect(screen.getByText('어떤 감정을 연기해 볼래요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('어떤 상황이면 좋겠어요?')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('어떤 상황이면 좋겠어요?'), '아버지가 내 원서를 버렸어요');
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('몇 명이 나오고,\n어떤 대본이면 좋겠어요?')).toBeOnTheScreen();
}

test('pen P14.1·P14.2 — 감정은 서운함부터, 상황은 오랜만의 재회·이별·오디션 직전·가족 다툼·고백·사과, 방향 단계는 인원 먼저와 고른 것 알약', async () => {
  await render(<ScriptCocreateScreen />);
  const emotions = screen.getAllByRole('radio').map((node) => node.props.accessibilityLabel);
  expect(emotions).toEqual(['서운함', '설렘', '분노', '슬픔', '긴장', '담담함', '잘 모르겠어요']);
  await fireEvent.press(screen.getByText('서운함'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  const situations = screen.getAllByRole('radio').map((node) => node.props.accessibilityLabel);
  expect(situations).toEqual(['오랜만의 재회', '이별', '오디션 직전', '가족 다툼', '고백', '사과', '아무거나 좋아요']);
  await fireEvent.press(screen.getByText('오랜만의 재회'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('몇 명이 나와요?')).toBeOnTheScreen();
  expect(screen.getByPlaceholderText('예: 상대가 끝까지 차갑게 굴었으면 좋겠어요')).toBeOnTheScreen();
  expect(screen.getByTestId('cocreate-picked')).toHaveTextContent(/서운함.*오랜만의 재회/);
});

test('감정 → 상황 → 방향을 묻고 프로필 경력과 함께 독백 1분을 만든 뒤, 넓은 대본과 수정·확정 두 버튼을 보인다', async () => {
  createSampleScript.mockResolvedValue(sample());
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));

  expect(createSampleScript).toHaveBeenCalledWith(expect.objectContaining({
    experience: 'exam',
    age: 19,
    gender: 'male',
    goal: 'audition',
    emotion: '분노',
    situation: '아버지가 내 원서를 버렸어요',
    direction: null,
    character_count: 1,
    length_minutes: 1,
  }));
  expect(await screen.findByText('잠긴 서랍')).toBeOnTheScreen();
  expect(screen.getByText('도윤 · 독백 · 약 1분')).toBeOnTheScreen();
  expect(screen.getByText('휴지통에 있는 거, 내 원서 맞죠.')).toBeOnTheScreen();
  expect(screen.getByText('(아버지가 등을 돌린다)')).toBeOnTheScreen();
  expect(screen.getByText('다시 만들기 · 무료 3번 중 3번 남음')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '감정 더 세게' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '수정하기' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '이 대본으로 확정' })).toBeOnTheScreen();
});

test('만들기에 실패하면 방향 화면으로 돌아와 이유를 보인다 — 뒤로는 앞 단계로 간다', async () => {
  createSampleScript.mockRejectedValue(new ApiError(429, 'limit', 'sample_script_daily_limit'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('radio', { name: '2명' }));
  await fireEvent.press(screen.getByRole('radio', { name: '약 3분' }));
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));

  expect(createSampleScript).toHaveBeenCalledWith(expect.objectContaining({ character_count: 2, length_minutes: 3 }));
  expect(await screen.findByText('오늘은 대본을 충분히 만들었어요. 내일 다시 만들어 주세요.')).toBeOnTheScreen();
  expect(screen.getByText('대본을 만들지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByText('어떤 상황이면 좋겠어요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByText('어떤 감정을 연기해 볼래요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('수정하기 — 바꾼 것이 없으면 적용을 누를 수 없고, 고치면 새 버전과 남은 횟수를 보이며 이전 버전으로 되돌릴 수 있다', async () => {
  createSampleScript.mockResolvedValue(sample());
  reviseSampleScript.mockResolvedValue(sample({ version: 2, version_count: 2, revisions_used: 1, revisions_left: 2, title: '고친 서랍', note: '마지막 대사를 담담하게 바꿨어요.' }));
  restoreSampleScript.mockResolvedValue(sample({ version: 1, version_count: 2, revisions_used: 1, revisions_left: 2 }));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '수정하기' }));

  expect(screen.getByRole('button', { name: '수정 적용' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('어떻게 고칠까요?'), '마지막 대사만 담담하게');
  await fireEvent.press(screen.getByRole('button', { name: '수정 적용' }));

  expect(reviseSampleScript).toHaveBeenCalledWith('s1', { base_version: 1, text: '마지막 대사만 담담하게' });
  expect(await screen.findByText('고친 서랍')).toBeOnTheScreen();
  expect(screen.getByText('마지막 대사를 담담하게 바꿨어요.')).toBeOnTheScreen();
  expect(screen.getByText('다시 만들기 · 무료 3번 중 2번 남음')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '이전 버전으로 되돌리기' }));
  expect(restoreSampleScript).toHaveBeenCalledWith('s1', 1);
  expect(await screen.findByText('잠긴 서랍')).toBeOnTheScreen();
});

test('수정이 실패하면 수정 화면에 남아 이유를 보이고, 무료 수정을 다 쓰면 수정하기를 막고 안내만 한다', async () => {
  createSampleScript.mockResolvedValue(sample());
  reviseSampleScript.mockRejectedValueOnce(new ApiError(502, 'failed', 'sample_script_revision_failed'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '수정하기' }));
  await fireEvent.press(screen.getByRole('radio', { name: '2명' }));
  await fireEvent.press(screen.getByRole('button', { name: '수정 적용' }));

  expect(reviseSampleScript).toHaveBeenCalledWith('s1', { base_version: 1, character_count: 2 });
  expect(await screen.findByText('고치지 못했어요. 원래 대본은 그대로예요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));

  reviseSampleScript.mockResolvedValueOnce(sample({ version: 2, revisions_used: 3, revisions_left: 0 }));
  await fireEvent.press(screen.getByRole('button', { name: '수정하기' }));
  await fireEvent.changeText(screen.getByLabelText('어떻게 고칠까요?'), '더 짧게');
  await fireEvent.press(screen.getByRole('button', { name: '수정 적용' }));
  expect(await screen.findByText('무료 수정 3번을 다 썼어요. 이 대본으로 확정하거나 새로 만들어 주세요.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '수정하기' })).toBeDisabled();
});

test('확정하면 내 대본에 저장하고, 지금 찍을래요는 장면 칸을 채워 찍는 법으로, 나중에 찍을게요는 돌아간다', async () => {
  createSampleScript.mockResolvedValue(sample());
  saveSampleScript.mockResolvedValue({ id: 's1', script_id: 'script-1' });
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '이 대본으로 확정' }));

  expect(saveSampleScript).toHaveBeenCalledWith('s1');
  expect(await screen.findByText('내 대본에 저장했어요')).toBeOnTheScreen();
  expect(require('@/lib/reading/store').rememberMyRoles).toHaveBeenCalledWith('script-1', ['도윤']);
  await fireEvent.press(screen.getByRole('button', { name: '지금 찍을래요' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({
    kind: 'reading',
    scene: { situation: '잠긴 서랍 · 거실, 밤 · 아버지가 원서를 버렸다', character: '도윤 (아버지와 아들, 존댓말)', goal: '원서를 돌려받는다' },
  });
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } });
  await fireEvent.press(screen.getByRole('button', { name: '나중에 찍을게요' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('저장한 화면에 대본이 그대로 보이고, 리딩에서 읽어 보기는 그 대본을 리딩 화면으로 연다', async () => {
  createSampleScript.mockResolvedValue(sample());
  saveSampleScript.mockResolvedValue({ id: 's1', script_id: 'script-1' });
  const { loadIntoCurrent } = require('@/lib/reading/store');
  loadIntoCurrent.mockResolvedValue({ id: 'script-1' });
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '이 대본으로 확정' }));

  expect(await screen.findByText('내 대본에 저장했어요')).toBeOnTheScreen();
  expect(screen.getByText('잠긴 서랍')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '리딩에서 읽어 보기' }));
  expect(loadIntoCurrent).toHaveBeenCalledWith('script-1');
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading');
    expect(mockRouter.push).toHaveBeenCalledWith('/reading/detail');
});

test('확정이 실패하면 결과 화면에 이유를 보인다', async () => {
  createSampleScript.mockResolvedValue(sample());
  saveSampleScript.mockRejectedValue(new ApiError(422, 'limit', 'script_limit'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '이 대본으로 확정' }));
  expect(await screen.findByText('내 대본이 가득 찼어요. 리딩에서 안 쓰는 대본을 지운 뒤 다시 확정해 주세요.')).toBeOnTheScreen();
});

test('코칭 탭의 입구 줄은 대사 같이 만들기 화면으로 간다', async () => {
  await render(<ScriptCocreateEntry />);
  await fireEvent.press(screen.getByRole('button', { name: '찍을 대사부터 같이 만들기' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/script-cocreate');
});


test('생성 응답 유실 뒤 같은 입력 재시도는 request_id 유지, 입력 변경은 새 id', async () => {
  createSampleScript.mockRejectedValue(new Error('network'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await screen.findByText('대본을 만들지 못했어요');
  await fireEvent.press(screen.getByRole('button', { name: '다시 만들기' }));
  await screen.findByText('대본을 만들지 못했어요');
  expect(createSampleScript.mock.calls[1][0].request_id).toBe(createSampleScript.mock.calls[0][0].request_id);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  await fireEvent.press(screen.getByRole('radio', { name: '약 3분' }));
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(createSampleScript.mock.calls[2][0].request_id).not.toBe(createSampleScript.mock.calls[0][0].request_id);
});

test('서버 수정 성공 후 응답 유실은 GET 최신 결과로 복구하고 추가 수정을 보내지 않는다', async () => {
  createSampleScript.mockResolvedValue(sample());
  reviseSampleScript.mockRejectedValue(new Error('response lost'));
  (api.getSampleScript as jest.Mock).mockResolvedValue(sample({ version: 2, version_count: 2, revisions_used: 1, revisions_left: 2, title: '복구된 서랍' }));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '수정하기' }));
  await fireEvent.changeText(screen.getByLabelText('어떻게 고칠까요?'), '담담하게');
  await fireEvent.press(screen.getByRole('button', { name: '수정 적용' }));
  expect(await screen.findByText('복구된 서랍')).toBeOnTheScreen();
  expect(reviseSampleScript).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: '수정하기' }));
  reviseSampleScript.mockResolvedValueOnce(sample({ version: 3, version_count: 3 }));
  await fireEvent.changeText(screen.getByLabelText('어떻게 고칠까요?'), '짧게');
  await fireEvent.press(screen.getByRole('button', { name: '수정 적용' }));
  expect(reviseSampleScript.mock.calls[1][1].base_version).toBe(2);
});

 test('리딩은 2명으로 만들고 확정한 대본의 상세로 간다', async () => {
  mockParams.mode = 'reading';
  createSampleScript.mockResolvedValue(sample({ character_count: 2 }));
  saveSampleScript.mockResolvedValue({ script_id: 'reading-1' });
  const { loadIntoCurrent } = require('@/lib/reading/store');
  loadIntoCurrent.mockResolvedValue({ characters: [{}, {}] });
  await render(<ScriptCocreateScreen />);
  await fireEvent.press(screen.getByText('새로 만들기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  await reachDirection(true);
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(createSampleScript).toHaveBeenCalledWith(expect.objectContaining({ character_count: 2 }));
  await fireEvent.press(await screen.findByRole('button', { name: '이 대본으로 확정' }));
  expect(loadIntoCurrent).toHaveBeenCalledWith('reading-1');
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading');
    expect(mockRouter.push).toHaveBeenCalledWith('/reading/detail');
  expect(setContinueOrigin).not.toHaveBeenCalled();
});

test('실패 화면 — 다시 만들기는 같은 요청 id로 다시 부르고, 내 대본 넣기는 reading/new 로 간다', async () => {
  createSampleScript.mockRejectedValueOnce(new ApiError(422, 'x', 'unknown')).mockResolvedValueOnce(sample());
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(await screen.findByText('대본을 만들지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 만들기' }));
  expect(await screen.findByText('잠긴 서랍')).toBeOnTheScreen();
  const [first, second] = createSampleScript.mock.calls;
  expect(second[0].request_id).toBe(first[0].request_id);
  // 실패한 시도는 횟수에서 빼 준다.
  expect(screen.getByText('다시 만들기 · 무료 3번 중 3번 남음')).toBeOnTheScreen();
});

test('실패 화면에서 내 대본 넣기를 누르면 reading/new 로 간다', async () => {
  createSampleScript.mockRejectedValue(new ApiError(422, 'x', 'unknown'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '내 대본 넣기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/new');
});

test('수정 칩을 누르면 칩 문구를 지시로 reviseSampleScript 를 부르고 고친 대본을 보인다', async () => {
  createSampleScript.mockResolvedValue(sample());
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await screen.findByText('잠긴 서랍');
  reviseSampleScript.mockResolvedValueOnce(sample({ version: 2, title: '짧아진 서랍', revisions_left: 2 }));
  await fireEvent.press(screen.getByRole('button', { name: '더 짧게' }));
  expect(await screen.findByText('짧아진 서랍')).toBeOnTheScreen();
  expect(reviseSampleScript).toHaveBeenCalledWith('s1', { base_version: 1, text: '대본을 더 짧게 줄여 주세요' });
  expect(screen.getByText('다시 만들기 · 무료 3번 중 2번 남음')).toBeOnTheScreen();
});

test('다시 만들기를 앱이 센 횟수로 3번까지 쓰면 막는다', async () => {
  createSampleScript.mockResolvedValue(sample({ revisions_left: 3 }));
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  await screen.findByText('잠긴 서랍');
  for (let i = 2; i >= 0; i--) {
    await fireEvent.press(screen.getByRole('button', { name: new RegExp('다시 만들기') }));
    await screen.findByText(`다시 만들기 · 무료 3번 중 ${i}번 남음`);
  }
  expect(screen.getByRole('button', { name: /다시 만들기/ })).toBeDisabled();
});

test('리딩 탭에서 열면 예시 고르기/새로 만들기를 먼저 묻는다', async () => {
  mockParams.mode = 'reading';
  await render(<ScriptCocreateScreen />);
  expect(screen.getByText('어떤 대본으로 할까요?')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  await fireEvent.press(screen.getByText('예시 대본 고르기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/sample');
});

test('리딩 탭에서 새로 만들기를 고르면 감정 단계로 간다', async () => {
  mockParams.mode = 'reading';
  await render(<ScriptCocreateScreen />);
  await fireEvent.press(screen.getByText('새로 만들기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('어떤 감정을 연기해 볼래요?')).toBeOnTheScreen();
});

test('내 대본 올리기에서 「새로 만들기」를 고르고 오면 처음 고르기 없이 감정부터 묻고, 뒤로 가면 올리기 화면으로 돌아간다', async () => {
  mockParams.mode = 'reading';
  mockParams.start = 'make';
  await render(<ScriptCocreateScreen />);
  expect(screen.queryByText('어떤 대본으로 할까요?')).not.toBeOnTheScreen();
  expect(screen.getByText('어떤 감정을 연기해 볼래요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalled();
  expect(screen.queryByText('어떤 대본으로 할까요?')).not.toBeOnTheScreen();
});

test('만드는 중 — 화면을 닫지 말라고 안내하고, 뒤로 가면 코칭 탭 첫 화면으로 간다(코칭 입구에서 열었을 때)', async () => {
  createSampleScript.mockReturnValue(new Promise(() => undefined));
  await reachDirection();
  void fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));

  expect(await screen.findByText('30초에서 1분쯤 걸려요. 화면을 닫지 말고 기다려 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('화면을 나가도 대본은 계속 만들어져요')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  // 나가면 만든 대본을 다시 찾을 수 없어 먼저 묻는다. 「계속 기다리기」면 남는다.
  expect(await screen.findByText('지금 나가면 만들던 대본이 사라져요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '계속 기다리기' }));
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  await fireEvent.press(await screen.findByRole('button', { name: '나가기' }));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/coaching'));
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('만드는 중 — 대본 올리기(리딩)에서 열었으면 안드로이드 뒤로 키·밀어서 나가기도 리딩 탭 첫 화면으로 간다', async () => {
  mockParams.mode = 'reading';
  mockParams.start = 'make';
  createSampleScript.mockReturnValue(new Promise(() => undefined));
  await reachDirection();
  void fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(await screen.findByText('30초에서 1분쯤 걸려요. 화면을 닫지 말고 기다려 주세요.')).toBeOnTheScreen();

  const preventRemove = jest.requireMock('@react-navigation/native').usePreventRemove as jest.Mock;
  expect(preventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  await act(async () => preventRemove.mock.calls.at(-1)[1]({ data: { action: { type: 'GO_BACK' } } }));
  await fireEvent.press(await screen.findByRole('button', { name: '나가기' }));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading'));
});

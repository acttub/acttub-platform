import { fireEvent, render, screen } from '@testing-library/react-native';

import ScriptCocreateScreen from '@/app/script-cocreate';
import { ScriptCocreateEntry } from '@/components/script-cocreate-entry';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { SampleScript } from '@/lib/script-cocreate';

const mockParams: { mode?: string } = {};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, Stack: { Screen: () => null } }));
jest.mock('expo-image', () => ({ Image: () => null }));
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
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn() }));
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
  (api.getSampleScript as jest.Mock).mockResolvedValue(sample());
});

async function reachDirection() {
  await render(<ScriptCocreateScreen />);
  expect(screen.getByText('어떤 감정을 연습하고 싶어요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('분노'));
  expect(screen.getByText('어떤 상황이면 좋아요?')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('어떤 상황이면 좋아요?'), '아버지가 내 원서를 버렸어요');
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('원하는 방향이 있으면 적어 주세요')).toBeOnTheScreen();
}

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
  expect(screen.getByText('무료 수정 3번 남았어요')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '수정하기' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '이 대본으로 확정' })).toBeOnTheScreen();
});

test('만들기에 실패하면 방향 화면으로 돌아와 이유를 보인다 — 뒤로는 앞 단계로 간다', async () => {
  createSampleScript.mockRejectedValue(new ApiError(429, 'limit', 'sample_script_daily_limit'));
  await reachDirection();
  await fireEvent.press(screen.getByRole('radio', { name: '2명 (대화)' }));
  await fireEvent.press(screen.getByRole('radio', { name: '약 3분' }));
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));

  expect(createSampleScript).toHaveBeenCalledWith(expect.objectContaining({ character_count: 2, length_minutes: 3 }));
  expect(await screen.findByText('오늘은 대본을 충분히 만들었어요. 내일 다시 만들어 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByText('어떤 상황이면 좋아요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByText('어떤 감정을 연습하고 싶어요?')).toBeOnTheScreen();
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
  expect(screen.getByText('무료 수정 2번 남았어요')).toBeOnTheScreen();

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
  await fireEvent.press(screen.getByRole('radio', { name: '2명 (대화)' }));
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
  await fireEvent.press(screen.getByRole('button', { name: '지금 찍을래요' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({
    kind: 'reading',
    scene: { situation: '잠긴 서랍 · 거실, 밤 · 아버지가 원서를 버렸다', character: '도윤 (아버지와 아들, 존댓말)', goal: '원서를 돌려받는다' },
  });
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/record-guide', params: { next: 'upload' } });
  await fireEvent.press(screen.getByRole('button', { name: '나중에 찍을게요' }));
  expect(mockRouter.back).toHaveBeenCalled();
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
  await screen.findByText('원하는 방향이 있으면 적어 주세요');
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(createSampleScript.mock.calls[1][0].request_id).toBe(createSampleScript.mock.calls[0][0].request_id);
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

 test('리딩은 2명으로 만들고 확정한 대본의 배역 선택으로 간다', async () => {
  mockParams.mode = 'reading';
  createSampleScript.mockResolvedValue(sample({ character_count: 2 }));
  saveSampleScript.mockResolvedValue({ script_id: 'reading-1' });
  const { loadIntoCurrent } = require('@/lib/reading/store');
  loadIntoCurrent.mockResolvedValue({ characters: [{}, {}] });
  await reachDirection();
  await fireEvent.press(screen.getByRole('button', { name: '대본 만들기' }));
  expect(createSampleScript).toHaveBeenCalledWith(expect.objectContaining({ character_count: 2 }));
  await fireEvent.press(await screen.findByRole('button', { name: '이 대본으로 확정' }));
  expect(loadIntoCurrent).toHaveBeenCalledWith('reading-1');
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/reading/roles', params: { from: 'new' } });
  expect(setContinueOrigin).not.toHaveBeenCalled();
});

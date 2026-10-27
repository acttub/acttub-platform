import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReportDetailScreen from '@/app/report-detail';
import { api } from '@/lib/api';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeDetail, PracticeNote } from '@/lib/practice/types';
import { practiceNote } from '../helpers/practice-note';

const mockRouter = { push: jest.fn() };
let mockParams: { practiceId?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('@/lib/api', () => ({
  api: { getPracticeNote: jest.fn(), getPractice: jest.fn(), getPracticeGroup: jest.fn() },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));

const getPracticeNote = api.getPracticeNote as jest.Mock;
const getPractice = api.getPractice as jest.Mock;
const getPracticeGroup = api.getPracticeGroup as jest.Mock;

const note = practiceNote;

const practice = { id: 'p1', root_id: 'root1', scene: { situation: '이별 통보 장면' } } as unknown as PracticeDetail;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { practiceId: 'p1' };
  getPractice.mockResolvedValue(practice);
  getPracticeGroup.mockResolvedValue({ in_progress_practice_id: null });
});

test('노트의 제목·종류·날짜·다음 한 가지를 보여 준다', async () => {
  getPracticeNote.mockResolvedValue(note());
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('첫 대사의 숨')).toBeOnTheScreen();
  expect(getPracticeNote).toHaveBeenCalledWith('p1');
  expect(screen.getByText('다음에 해볼 것까지')).toBeOnTheScreen();
  expect(screen.getByText('3월 5일')).toBeOnTheScreen();
  expect(screen.getByText('첫 줄 전에 한 박자 쉬기')).toBeOnTheScreen();
  expect(screen.queryByText('정리를 다 만들지 못해 확인된 것만 담았어요.')).not.toBeOnTheScreen();
});

test('제목 없는 노트는 장면 상황을 제목으로 쓰고, 대체 노트면 그렇게 알린다', async () => {
  getPracticeNote.mockResolvedValue(note({ title: null, kind: 'record_only', fallback: true }));
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('이별 통보 장면')).toBeOnTheScreen();
  expect(screen.getByText('정리를 다 만들지 못해 확인된 것만 담았어요.')).toBeOnTheScreen();
});

test('장면도 못 읽으면 제목 없는 연습 문구를 쓰고, 다음 테이크는 불러오기 실패를 알린다', async () => {
  getPracticeNote.mockResolvedValue(note({ title: null }));
  getPractice.mockRejectedValue(new Error('down'));
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('장면 메모 없이 연습')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다음 테이크 찍기' }));

  expect(await screen.findByText('연습 노트를 불러오지 못했어요.')).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(getPracticeGroup).not.toHaveBeenCalled();
});

test('열린 테이크가 없으면 같은 묶음의 다음 회차를 만들러 업로드로 간다', async () => {
  getPracticeNote.mockResolvedValue(note());
  await render(<ReportDetailScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '다음 테이크 찍기' }));

  expect(getPracticeGroup).toHaveBeenCalledWith('root1');
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'root1', practiceId: 'p1' });
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
});

test('묶음에 열린 테이크가 있으면 그 대화로 돌아간다', async () => {
  getPracticeNote.mockResolvedValue(note());
  getPracticeGroup.mockResolvedValue({ in_progress_practice_id: 'p9' });
  await render(<ReportDetailScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '대화 이어 가기' }));

  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p9' } });
  expect(setContinueOrigin).not.toHaveBeenCalled();
});

test('노트가 아직 없으면 정리 없음만 보여 주고 다시 시도는 두지 않는다', async () => {
  getPracticeNote.mockRejectedValue(Object.assign(new Error('nf'), { code: 'note_not_found' }));
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('아직 정리가 없어요')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeOnTheScreen();
});

test('노트를 못 읽으면 다시 시도로 다시 불러온다', async () => {
  getPracticeNote.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(note());
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('연습 노트를 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  expect(await screen.findByText('첫 대사의 숨')).toBeOnTheScreen();
  expect(getPracticeNote).toHaveBeenCalledTimes(2);
});

test('회차 id 없이 열면 서버에 묻지 않고 불러오기 실패를 보여 준다', async () => {
  mockParams = {};
  await render(<ReportDetailScreen />);

  expect(await screen.findByText('연습 노트를 불러오지 못했어요')).toBeOnTheScreen();
  expect(getPracticeNote).not.toHaveBeenCalled();
});

test('먼저 보낸 요청이 늦게 오면 버리고 나중 결과만 보여 준다', async () => {
  let resolveFirst!: (v: PracticeNote) => void;
  getPracticeNote
    .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValueOnce(note({ title: '두 번째' }));
  const view = await render(<ReportDetailScreen />);

  mockParams = { practiceId: 'p2' };
  await view.rerender(<ReportDetailScreen />);
  expect(await screen.findByText('연습 노트를 불러오지 못했어요')).toBeOnTheScreen();

  resolveFirst(note({ title: '첫 번째' }));
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  expect(await screen.findByText('두 번째')).toBeOnTheScreen();
  expect(screen.queryByText('첫 번째')).not.toBeOnTheScreen();
});

test('늦게 온 실패도 버린다', async () => {
  let rejectFirst!: (e: unknown) => void;
  getPracticeNote
    .mockReturnValueOnce(new Promise((_, j) => (rejectFirst = j)))
    .mockResolvedValueOnce(note({ title: '나중 노트' }));
  const view = await render(<ReportDetailScreen />);

  mockParams = { practiceId: 'p2' };
  await view.rerender(<ReportDetailScreen />);
  expect(await screen.findByText('나중 노트')).toBeOnTheScreen();

  rejectFirst(new Error('late'));
  await waitFor(() => expect(screen.queryByText('연습 노트를 불러오지 못했어요')).not.toBeOnTheScreen());
  expect(screen.getByText('나중 노트')).toBeOnTheScreen();
});

test('다른 회차로 바뀐 뒤 늦게 온 이전 묶음 정보는 버튼에 반영하지 않는다', async () => {
  let resolveOldGroup!: (v: unknown) => void;
  getPracticeNote.mockResolvedValue(note());
  getPractice
    .mockResolvedValueOnce(practice)
    .mockResolvedValueOnce({ ...practice, id: 'p2', root_id: 'root2' });
  getPracticeGroup
    .mockReturnValueOnce(new Promise((r) => (resolveOldGroup = r)))
    .mockResolvedValueOnce({ in_progress_practice_id: null });
  const view = await render(<ReportDetailScreen />);
  await screen.findByText('첫 대사의 숨');

  mockParams = { practiceId: 'p2' };
  await view.rerender(<ReportDetailScreen />);
  await waitFor(() => expect(getPracticeGroup).toHaveBeenLastCalledWith('root2'));

  resolveOldGroup({ in_progress_practice_id: 'p9' });
  await new Promise((r) => setTimeout(r, 0));
  expect(await screen.findByRole('button', { name: '다음 테이크 찍기' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '대화 이어 가기' })).not.toBeOnTheScreen();
});

test('묶음을 못 읽으면 다음 테이크 찍기로 둔다', async () => {
  getPracticeNote.mockResolvedValue(note());
  getPracticeGroup.mockRejectedValue(new Error('down'));
  await render(<ReportDetailScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '다음 테이크 찍기' }));
  expect(getPracticeGroup).toHaveBeenCalledWith('root1');
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
});

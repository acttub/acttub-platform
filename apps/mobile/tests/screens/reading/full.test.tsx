import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReadingFull from '@/app/reading/full';
import { ApiError } from '@/lib/api-request';
import { resetReadingState, updateCurrent } from '@/lib/reading/store';

import { openFixtureScript, scriptDetail, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, dismissTo: mockDismissTo }) }));

beforeEach(() => mockReplace.mockClear());

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingFull />);

  expect(screen.getByText('대본이 없어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockDismissTo).toHaveBeenCalledWith('/reading');
});

test('대본의 장면·지문·대사를 순서대로 보여 준다', async () => {
  await openFixtureScript();
  await updateCurrent({ myRoles: ['민재'] });
  await render(<ReadingFull />);

  expect(screen.getByText('봄날의 대화')).toBeOnTheScreen();
  expect(screen.getByText('1장 카페')).toBeOnTheScreen();
  expect(screen.getByText('서연이 자리에 앉는다.')).toBeOnTheScreen();
  expect(screen.getAllByText('민재')).toHaveLength(2);
  expect(screen.getByText('응, 늦어서 미안해.')).toBeOnTheScreen();
});

test('대사 줄을 눌러 글을 고치면 서버에 고친 글만 보내고 고친 대본을 다시 그린다', async () => {
  const fixed = scriptDetail([...TWO_ROLE_LINES.slice(0, 3), ['dialogue', '서연', '응, 늦어서 정말 미안해.'], TWO_ROLE_LINES[4]]);
  const { server } = await openFixtureScript();
  server.patchLine.mockResolvedValue(fixed);
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('고치기'));
  await fireEvent.changeText(screen.getByLabelText('글'), '응, 늦어서 정말 미안해.');
  await fireEvent.press(screen.getByText('저장'));

  expect(await screen.findByText('응, 늦어서 정말 미안해.')).toBeOnTheScreen();
  expect(server.patchLine).toHaveBeenCalledWith('s1', 'l4', { text: '응, 늦어서 정말 미안해.' });
  expect(screen.queryByText('응, 늦어서 미안해.')).not.toBeOnTheScreen();
});

test('지문 줄을 눌렀다가 취소하면 서버에 아무것도 보내지 않는다', async () => {
  const { server } = await openFixtureScript();
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('서연이 자리에 앉는다.'));
  await fireEvent.press(screen.getByText('고치기'));
  await fireEvent.press(screen.getByText('취소'));

  expect(screen.queryByText('저장')).not.toBeOnTheScreen();
  expect(server.patchLine).not.toHaveBeenCalled();
});

test('줄을 누르면 고치기·나누기·지우기 메뉴가 뜨고, 고치기는 줄 고치기 시트를 연다(SOMA-785)', async () => {
  await openFixtureScript();
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  expect(screen.getByText('서연 · 응, 늦어서 미안해.')).toBeOnTheScreen();
  expect(screen.getByText('나누기')).toBeOnTheScreen();
  expect(screen.getByText('지우기')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('고치기'));
  expect(screen.getByLabelText('글')).toBeOnTheScreen();
});

test('이 대사 지우기는 한 번 묻고 지운 뒤 서버가 돌려준 대본을 그린다(SOMA-785)', async () => {
  const removed = scriptDetail([...TWO_ROLE_LINES.slice(0, 3), TWO_ROLE_LINES[4]]);
  const { server } = await openFixtureScript();
  server.deleteLine.mockResolvedValue(removed);
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('지우기'));
  expect(screen.getByText('이 대사를 지울까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('지우기'));

  await waitFor(() => expect(screen.queryByText('응, 늦어서 미안해.')).not.toBeOnTheScreen());
  expect(server.deleteLine).toHaveBeenCalledWith('s1', 'l4');
});

test('지우기를 취소하면 서버에 보내지 않고, 서버가 거절하면 이유를 알린다(SOMA-785)', async () => {
  const { server } = await openFixtureScript();
  server.deleteLine.mockRejectedValue(new ApiError(422, 'unprocessable', 'empty_range', 'empty_range'));
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('지우기'));
  await fireEvent.press(screen.getByText('취소'));
  expect(server.deleteLine).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('지우기'));
  await fireEvent.press(screen.getByText('지우기'));
  expect(await screen.findByText('이 대사 하나만 연습한 기록이 있어 지울 수 없어요.')).toBeOnTheScreen();
  expect(screen.getByText('응, 늦어서 미안해.')).toBeOnTheScreen();
});

test('둘로 나누기는 문장 사이를 자를 곳으로 앞뒤 칸을 채워 두고, 고친 두 글을 보낸다(SOMA-785)', async () => {
  const lines = [['dialogue', '민재', '안녕하세요. 저는 이영입니다. 만나서 반갑습니다.'], ['dialogue', '서연', '반가워요.']] as Parameters<typeof scriptDetail>[0];
  const split = scriptDetail([['dialogue', '민재', '안녕하세요. 저는 이영입니다.'], ['dialogue', '민재', '만나서 반갑습니다.'], lines[1]]);
  const { server } = await openFixtureScript(scriptDetail(lines));
  server.splitLine.mockResolvedValue(split);
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('안녕하세요. 저는 이영입니다. 만나서 반갑습니다.'));
  await fireEvent.press(screen.getByText('나누기'));
  expect(screen.getByLabelText('앞 대사')).toHaveDisplayValue('안녕하세요. 저는 이영입니다.');
  expect(screen.getByLabelText('뒤 대사')).toHaveDisplayValue('만나서 반갑습니다.');
  await fireEvent.press(screen.getByRole('button', { name: '나누기' }));

  expect(await screen.findByText('만나서 반갑습니다.')).toBeOnTheScreen();
  expect(server.splitLine).toHaveBeenCalledWith('s1', 'l1', { first_text: '안녕하세요. 저는 이영입니다.', second_text: '만나서 반갑습니다.' });
});

test('나누기는 앞뒤 칸이 모두 있어야 누를 수 있고, 실패하면 시트에 알린다(SOMA-785)', async () => {
  const { server } = await openFixtureScript();
  server.splitLine.mockRejectedValue(new Error('offline'));
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('나누기'));
  await fireEvent.changeText(screen.getByLabelText('뒤 대사'), '  ');
  expect(screen.getByRole('button', { name: '나누기' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('뒤 대사'), '미안해.');
  await fireEvent.press(screen.getByRole('button', { name: '나누기' }));
  expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('취소'));
  expect(screen.queryByLabelText('앞 대사')).not.toBeOnTheScreen();
});

test('SOMA-597: 독백은 문장마다 한 줄로 보이고 위 안내가 「혼자 하는 대본이라 문장마다 나눴어요」다', async () => {
  await openFixtureScript(scriptDetail([
    ['dialogue', '민지', '그래서 더 말하기 싫었어.'],
    ['dialogue', '민지', '네가 그걸 아니까.'],
  ]));
  await render(<ReadingFull />);

  expect(screen.getByText('혼자 하는 대본이라 문장마다 나눴어요')).toBeOnTheScreen();
  expect(screen.getAllByText('민지')).toHaveLength(2);
  expect(screen.getByText('네가 그걸 아니까.')).toBeOnTheScreen();
});

// SOMA-806 예시 대본 — 같은 배역 연속 대사, 사이에 지문, 끝에 다른 배역.
const SAME_ROLE_LINES = [
  ['dialogue', '민재', '야, 어디 가?'],
  ['dialogue', '민재', '잠깐만 기다려 봐.'],
  ['direction', '(서연, 대답 없이 걸어간다)'],
  ['dialogue', '민재', '나도 같이 가자.'],
  ['dialogue', '민재', '왜 대답을 안 해?'],
  ['dialogue', '서연', '싫어.'],
] as Parameters<typeof scriptDetail>[0];

test('SOMA-806: 같은 배역 연속 대사는 배역 이름 하나 아래 줄마다 이어 보이고 지문에서 끊긴다', async () => {
  await openFixtureScript(scriptDetail(SAME_ROLE_LINES));
  await render(<ReadingFull />);

  // 민재 묶음 둘(지문이 끊는다) + 서연 하나.
  expect(screen.getAllByText('민재')).toHaveLength(2);
  expect(screen.getAllByText('서연')).toHaveLength(1);
  for (const text of ['야, 어디 가?', '잠깐만 기다려 봐.', '나도 같이 가자.', '왜 대답을 안 해?', '싫어.']) expect(screen.getByText(text)).toBeOnTheScreen();
});

test('SOMA-806: 묶인 대사 안에서도 줄마다 메뉴가 열리고 그 줄 하나만 나누거나 고친다', async () => {
  const relabeled = scriptDetail(SAME_ROLE_LINES.map((l, i) => (i === 4 ? (['dialogue', '서연', '왜 대답을 안 해?'] as const) : l)) as Parameters<typeof scriptDetail>[0]);
  const { server } = await openFixtureScript(scriptDetail(SAME_ROLE_LINES));
  server.patchLine.mockResolvedValue(relabeled);
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('잠깐만 기다려 봐.'));
  expect(screen.getByText('민재 · 잠깐만 기다려 봐.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('나누기'));
  expect(screen.getByLabelText('앞 대사')).toHaveDisplayValue('잠깐만');
  expect(screen.getByLabelText('뒤 대사')).toHaveDisplayValue('기다려 봐.');
  await fireEvent.press(screen.getByText('취소'));

  await fireEvent.press(screen.getByText('왜 대답을 안 해?'));
  expect(screen.getByText('민재 · 왜 대답을 안 해?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('고치기'));
  await fireEvent.press(screen.getByRole('radio', { name: '서연' }));
  await fireEvent.press(screen.getByText('저장'));

  // 뒤 줄의 배역을 바꾸면 따로 보이고 다음 서연 줄과 묶인다: 민재 묶음 둘, 서연 묶음 하나.
  await waitFor(() => expect(server.patchLine).toHaveBeenCalledWith('s1', 'l5', { character_id: 'c2' }));
  await waitFor(() => expect(screen.getAllByText('민재')).toHaveLength(2));
  expect(screen.getAllByText('서연')).toHaveLength(1);
});

test('아래에 추가는 고른 줄 아래에 빈 칸을 열고, 상대 배역이 먼저 골라져 있으며, 적은 글을 그 줄 id 로 보낸다(SOMA-816)', async () => {
  const added = scriptDetail([...TWO_ROLE_LINES.slice(0, 4), ['dialogue', '민재', '정말 괜찮아.'], TWO_ROLE_LINES[4]]);
  const { server } = await openFixtureScript();
  server.insertLineAfter.mockResolvedValue(added);
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('아래에 추가'));
  expect(screen.getByRole('radio', { name: '지문' })).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: '민재' })).toBeSelected();
  expect(screen.getByRole('button', { name: '추가' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('새 대사를 적어 주세요'), ' 정말 괜찮아. ');
  await fireEvent.press(screen.getByText('추가'));

  expect(await screen.findByText('정말 괜찮아.')).toBeOnTheScreen();
  expect(server.insertLineAfter).toHaveBeenCalledWith('s1', 'l4', { kind: 'dialogue', character_id: expect.any(String), text: '정말 괜찮아.' });
  expect(screen.queryByLabelText('새 대사를 적어 주세요')).not.toBeOnTheScreen();
});

test('아래에 추가에서 지문을 고르면 배역 없이 보내고, 취소하면 아무것도 보내지 않으며, 실패하면 칸 안에 알린다(SOMA-816)', async () => {
  const { server } = await openFixtureScript();
  server.insertLineAfter.mockRejectedValue(new Error('offline'));
  await render(<ReadingFull />);

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('아래에 추가'));
  await fireEvent.press(screen.getByText('취소'));
  expect(screen.queryByLabelText('새 대사를 적어 주세요')).not.toBeOnTheScreen();
  expect(server.insertLineAfter).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  await fireEvent.press(screen.getByText('아래에 추가'));
  await fireEvent.press(screen.getByRole('radio', { name: '지문' }));
  await fireEvent.changeText(screen.getByLabelText('새 대사를 적어 주세요'), '(사이)');
  await fireEvent.press(screen.getByText('추가'));
  expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(server.insertLineAfter).toHaveBeenCalledWith('s1', 'l4', { kind: 'direction', text: '(사이)' });
  expect(screen.getByLabelText('새 대사를 적어 주세요')).toBeOnTheScreen();
});

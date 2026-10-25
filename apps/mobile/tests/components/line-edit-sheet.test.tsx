import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { LineEditSheet } from '@/components/line-edit-sheet';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import type { LineDraft } from '@/lib/reading/line-edit';
import { editScriptLine, updateScriptMeta } from '@/lib/reading/store';
import type { ScriptCharacter } from '@/lib/reading/types';

jest.mock('@/lib/reading/store', () => ({ editScriptLine: jest.fn(), updateScriptMeta: jest.fn() }));
jest.mock('@/hooks/use-keyboard-height', () => ({ useKeyboardHeight: jest.fn(() => 0) }));

const editLine = editScriptLine as jest.Mock;
const updateMeta = updateScriptMeta as jest.Mock;
const keyboardHeight = useKeyboardHeight as jest.Mock;

const character = (id: string, name: string, order: number): ScriptCharacter => ({
  id,
  name,
  order,
  voice_preset: null,
  voice: 'alloy',
  dialogue_count: 3,
});
const CHARACTERS = [character('c1', '민재(소리)', 0), character('c2', '서연', 1)];
const DIALOGUE: LineDraft = { kind: 'dialogue', characterId: 'c1', text: '어디 가?' };
const DIRECTION: LineDraft = { kind: 'direction', characterId: null, text: '문이 닫힌다.' };

beforeEach(() => {
  editLine.mockReset().mockResolvedValue(undefined);
  updateMeta.mockReset().mockResolvedValue(undefined);
  keyboardHeight.mockReturnValue(0);
});

async function open(original: LineDraft | null = DIALOGUE, lineId: string | null = 'line-7') {
  const onClose = jest.fn();
  const view = await render(<LineEditSheet scriptId="s1" lineId={lineId} original={original} characters={CHARACTERS} onClose={onClose} />);
  return { onClose, view };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const textInput = () => screen.getByLabelText('글');

test.each([
  ['고칠 줄이 없으면', null, 'line-7'],
  ['줄 id 가 없으면', DIALOGUE, null],
] as const)('%s 시트를 띄우지 않는다', async (_, original, lineId) => {
  await open(original, lineId);
  expect(screen.queryByText('줄 고치기')).not.toBeOnTheScreen();
});

test('대사 줄은 종류·배역·글을 지금 값으로 채우고, 고친 게 없으면 저장이 꺼져 있다', async () => {
  await open();
  expect(screen.getByText('줄 고치기')).toBeOnTheScreen();
  expect(screen.getByText('고쳐도 지난 리딩과 녹음은 그대로 남아요.')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: '대사' })).toBeSelected();
  expect(screen.getByRole('radio', { name: '지문' })).not.toBeSelected();
  expect(screen.getByRole('radio', { name: '민재(소리)' })).toBeSelected();
  expect(screen.getByRole('radio', { name: '서연' })).not.toBeSelected();
  expect(screen.getByText("'민재(소리)' 이름 고치기")).toBeOnTheScreen();
  expect(textInput()).toHaveDisplayValue('어디 가?');
  expect(screen.getByText('저장')).toBeDisabled();
});

test('글을 고쳐 저장하면 바뀐 글만 보내고 저장했다고 닫는다', async () => {
  const { onClose } = await open();
  await fireEvent.changeText(textInput(), '  어디 가니?  ');
  await fireEvent.press(screen.getByText('저장'));

  expect(editLine.mock.calls).toEqual([['s1', 'line-7', { text: '어디 가니?' }]]);
  expect(updateMeta).not.toHaveBeenCalled();
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('앞뒤 공백만 바꾼 글은 고친 것이 아니다', async () => {
  await open();
  await fireEvent.changeText(textInput(), '어디 가?   ');
  expect(screen.getByText('저장')).toBeDisabled();
});

test('글을 비우면 저장할 수 없다', async () => {
  await open();
  await fireEvent.changeText(textInput(), '   ');
  expect(screen.getByText('저장')).toBeDisabled();
});

test('말하는 배역을 바꾸면 그 배역 id 를 보낸다', async () => {
  const { onClose } = await open();
  await fireEvent.press(screen.getByRole('radio', { name: '서연' }));
  expect(screen.getByRole('radio', { name: '서연' })).toBeSelected();
  expect(screen.getByText("'서연' 이름 고치기")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('저장'));
  expect(editLine.mock.calls).toEqual([['s1', 'line-7', { characterId: 'c2' }]]);
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('대사를 지문으로 바꾸면 배역 고르기가 사라지고 종류만 보낸다', async () => {
  await open();
  await fireEvent.press(screen.getByRole('radio', { name: '지문' }));

  expect(screen.getByRole('radio', { name: '지문' })).toBeSelected();
  expect(screen.queryByText('누가 말하나요')).not.toBeOnTheScreen();
  expect(screen.queryByRole('radio', { name: '서연' })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('저장'));
  expect(editLine.mock.calls).toEqual([['s1', 'line-7', { kind: 'direction' }]]);
});

test('대사→장면→대사로 돌아오면 원래 배역이 그대로라 고친 것이 없다', async () => {
  await open();
  await fireEvent.press(screen.getByRole('radio', { name: '장면' }));
  await fireEvent.press(screen.getByRole('radio', { name: '대사' }));
  expect(screen.getByRole('radio', { name: '민재(소리)' })).toBeSelected();
  expect(screen.getByText('저장')).toBeDisabled();
});

test('지문을 대사로 바꾸면 배역을 고를 때까지 저장할 수 없다', async () => {
  await open(DIRECTION);
  expect(screen.queryByText('누가 말하나요')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: '대사' }));
  expect(screen.getByText('누가 말하나요')).toBeOnTheScreen();
  expect(screen.queryByText(/이름 고치기/)).not.toBeOnTheScreen();
  expect(screen.getByText('저장')).toBeDisabled();

  await fireEvent.press(screen.getByRole('radio', { name: '서연' }));
  await fireEvent.press(screen.getByText('저장'));
  expect(editLine.mock.calls).toEqual([['s1', 'line-7', { kind: 'dialogue', characterId: 'c2' }]]);
});

test('배역 이름만 고쳐도 저장되고, 이름만 보낸다', async () => {
  const { onClose } = await open();
  await fireEvent.press(screen.getByText("'민재(소리)' 이름 고치기"));
  const rename = screen.getByLabelText("'민재(소리)' 이름 고치기");
  expect(rename).toHaveDisplayValue('민재(소리)');
  expect(screen.getByText('저장')).toBeDisabled();

  await fireEvent.changeText(rename, ' 민재 ');
  await fireEvent.press(screen.getByText('저장'));

  expect(updateMeta.mock.calls).toEqual([['s1', { characters: [{ id: 'c1', name: '민재' }] }]]);
  expect(editLine).not.toHaveBeenCalled();
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('이름과 글을 같이 고치면 이름을 먼저 고치고 줄을 고친다', async () => {
  const order: string[] = [];
  updateMeta.mockImplementation(async () => void order.push('meta'));
  editLine.mockImplementation(async () => void order.push('line'));
  await open();
  await fireEvent.press(screen.getByText("'민재(소리)' 이름 고치기"));
  await fireEvent.changeText(screen.getByLabelText("'민재(소리)' 이름 고치기"), '민재');
  await fireEvent.changeText(textInput(), '어디 가니?');
  await fireEvent.press(screen.getByText('저장'));

  expect(order).toEqual(['meta', 'line']);
  expect(editLine.mock.calls).toEqual([['s1', 'line-7', { text: '어디 가니?' }]]);
});

test('이름 칸을 비우면 이름 고치기로 치지 않는다', async () => {
  await open();
  await fireEvent.press(screen.getByText("'민재(소리)' 이름 고치기"));
  await fireEvent.changeText(screen.getByLabelText("'민재(소리)' 이름 고치기"), '   ');
  expect(screen.getByText('저장')).toBeDisabled();
});

test('이름을 고치다 다른 배역을 고르면 이름 칸이 접힌다', async () => {
  await open();
  await fireEvent.press(screen.getByText("'민재(소리)' 이름 고치기"));
  await fireEvent.changeText(screen.getByLabelText("'민재(소리)' 이름 고치기"), '민재');
  await fireEvent.press(screen.getByRole('radio', { name: '서연' }));

  expect(screen.queryByLabelText("'민재(소리)' 이름 고치기")).not.toBeOnTheScreen();
  expect(screen.getByText("'서연' 이름 고치기")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('저장'));
  expect(updateMeta).not.toHaveBeenCalled();
});

test('저장하는 동안은 닫히지 않고, 끝나면 저장했다고 닫는다', async () => {
  const pending = deferred();
  editLine.mockReturnValue(pending.promise);
  const { onClose } = await open();
  await fireEvent.changeText(textInput(), '어디 가니?');
  await fireEvent.press(screen.getByText('저장'));

  expect(screen.queryByText('저장')).not.toBeOnTheScreen();
  expect(screen.getByText('취소')).toBeDisabled();
  await fireEvent.press(backdrop());
  await fireEvent(modalTarget(), 'requestClose');
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => pending.resolve());
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('저장이 실패하면 시트를 그대로 두고 오류를 보인다', async () => {
  editLine.mockRejectedValue(new Error('down'));
  const { onClose } = await open();
  await fireEvent.changeText(textInput(), '어디 가니?');
  await fireEvent.press(screen.getByText('저장'));

  expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText('저장')).toBeEnabled();
});

test('다른 줄을 열면 고치던 내용과 오류를 지우고 그 줄로 채운다', async () => {
  editLine.mockRejectedValue(new Error('down'));
  const { view, onClose } = await open();
  await fireEvent.press(screen.getByText("'민재(소리)' 이름 고치기"));
  await fireEvent.changeText(textInput(), '어디 가니?');
  await fireEvent.press(screen.getByText('저장'));
  await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');

  await view.rerender(<LineEditSheet scriptId="s1" lineId="line-8" original={DIRECTION} characters={CHARACTERS} onClose={onClose} />);

  expect(textInput()).toHaveDisplayValue('문이 닫힌다.');
  expect(screen.getByRole('radio', { name: '지문' })).toBeSelected();
  expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: '대사' }));
  await fireEvent.press(screen.getByRole('radio', { name: '민재(소리)' }));
  expect(screen.getByText("'민재(소리)' 이름 고치기")).toBeOnTheScreen();
});

test('닫혀 있던 시트에 줄이 들어오면 그 줄로 열린다', async () => {
  const { view, onClose } = await open(null);
  await view.rerender(<LineEditSheet scriptId="s1" lineId="line-7" original={DIALOGUE} characters={CHARACTERS} onClose={onClose} />);
  expect(textInput()).toHaveDisplayValue('어디 가?');
});

test.each([
  ['취소', async () => fireEvent.press(screen.getByText('취소'))],
  ['바깥 누르기', async () => fireEvent.press(backdrop())],
  ['뒤로 가기', async () => fireEvent(modalTarget(), 'requestClose')],
])('%s 는 저장하지 않고 닫는다', async (_, close) => {
  const { onClose } = await open();
  await fireEvent.changeText(textInput(), '어디 가니?');
  await close();
  expect(onClose.mock.calls).toEqual([[false]]);
  expect(editLine).not.toHaveBeenCalled();
});

test('키보드가 떠 있어도 고쳐서 저장할 수 있다', async () => {
  keyboardHeight.mockReturnValue(320);
  const { onClose } = await open();
  await fireEvent.changeText(textInput(), '어디 가니?');
  await fireEvent.press(screen.getByText('저장'));
  expect(onClose.mock.calls).toEqual([[true]]);
});

// 시트가 accessibilityViewIsModal 이라 뒤의 바깥 칸은 스크린 리더에서 빠지지만 손으로는 누를 수 있다.
function backdrop() {
  return screen.getAllByRole('button', { includeHiddenElements: true })[0];
}

function modalTarget() {
  return screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];
}

test('묶인 대사(choices 둘 이상)면 맨 위 「고칠 줄」 칩으로 줄을 골라 그 줄을 고친다(SOMA-821)', async () => {
  const onClose = jest.fn();
  const choices = [
    { lineId: 'line-7', text: '어디 가?' },
    { lineId: 'line-8', text: '집에 가.' },
  ];
  await render(
    <LineEditSheet scriptId="s1" lineId="line-7" original={DIALOGUE} characters={CHARACTERS} choices={choices} onClose={onClose} />,
  );
  expect(screen.getByText('고칠 줄')).toBeOnTheScreen();
  expect(textInput()).toHaveDisplayValue('어디 가?');

  await fireEvent.press(screen.getByText('2. 집에 가.'));
  expect(textInput()).toHaveDisplayValue('집에 가.');
  await fireEvent.changeText(textInput(), '집에 갈래.');
  await fireEvent.press(screen.getByText('저장'));

  await act(async () => undefined);
  expect(editLine).toHaveBeenCalledWith('s1', 'line-8', { text: '집에 갈래.' });
  expect(onClose).toHaveBeenCalledWith(true);
});

test('줄이 하나뿐이면 「고칠 줄」 칩을 보이지 않는다', async () => {
  await open();
  expect(screen.queryByText('고칠 줄')).not.toBeOnTheScreen();
});

test('위 머리줄 닫기 X로 저장 없이 닫는다', async () => {
  const { onClose } = await open();
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(onClose).toHaveBeenCalledWith(false);
  expect(editLine).not.toHaveBeenCalled();
});

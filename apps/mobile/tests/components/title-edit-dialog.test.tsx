import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TitleEditDialog } from '@/components/title-edit-dialog';
import { updateScriptMeta } from '@/lib/reading/store';

jest.mock('@/lib/reading/store', () => ({ updateScriptMeta: jest.fn() }));

// 첫 테스트가 Modal 을 처음 변환·그리며 다른 작업과 겹치면 기본 5초를 넘긴다(측정: 단독 5.0초, 병렬 실행에서 시간 초과).
jest.setTimeout(20_000);

const update = updateScriptMeta as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
});

const SCRIPT = { id: 's1', title: '옥상, 밤' };
const field = () => screen.getByPlaceholderText('제목 없는 대본');
const saveButton = () => screen.getByText('저장');
const modal = () => screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];
// 배경은 KeyboardLift 안에 있어 Modal 첫 자식이 아니다.
const backdrop = () => screen.getByTestId('title-edit-backdrop');
const inside = { stopPropagation: jest.fn() };

async function open(script: { id: string; title: string } | null = SCRIPT) {
  const onClose = jest.fn();
  const view = await render(<TitleEditDialog script={script} onClose={onClose} />);
  return { onClose, view };
}

test('대본이 없으면 아무것도 그리지 않는다', async () => {
  await open(null);

  expect(screen.queryByText('제목 수정')).toBeNull();
});

test('지금 제목을 채워 열고, 제목이 바뀌기 전에는 저장이 꺼져 있다', async () => {
  const { onClose } = await open();

  expect(screen.getByText('제목 수정')).toBeOnTheScreen();
  expect(field()).toHaveDisplayValue('옥상, 밤');
  expect(saveButton()).toBeDisabled();

  await fireEvent.press(saveButton());
  expect(update.mock.calls).toEqual([]);
  expect(onClose.mock.calls).toEqual([]);
});

test('바꾼 제목을 앞뒤 공백을 걷어 저장하고 저장됨으로 닫는다', async () => {
  const { onClose } = await open();

  await fireEvent.changeText(field(), '  새벽, 옥상  ');
  expect(saveButton()).toBeEnabled();
  await fireEvent.press(saveButton());

  expect(update.mock.calls).toEqual([['s1', { title: '새벽, 옥상' }]]);
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('지우기를 누르면 칸이 비고, 빈 제목은 "제목 없는 대본"으로 저장한다', async () => {
  const { onClose } = await open();

  await fireEvent.press(screen.getByLabelText('닫기'));

  expect(field()).toHaveDisplayValue('');
  expect(screen.queryByLabelText('닫기')).toBeNull();
  await fireEvent.press(saveButton());

  expect(update.mock.calls).toEqual([['s1', { title: '제목 없는 대본' }]]);
  expect(onClose.mock.calls).toEqual([[true]]);
});

test('제목 없는 대본에 공백만 적으면 바뀐 게 없어 저장이 꺼진다', async () => {
  await open({ id: 's2', title: '제목 없는 대본' });

  await fireEvent.changeText(field(), '   ');

  expect(saveButton()).toBeDisabled();
});

test('저장 중에는 버튼이 돌고 배경·취소로 닫히지 않으며, 실패하면 알리고 열어 둔다', async () => {
  const pending = deferred<unknown>();
  update.mockReturnValue(pending.promise);
  const { onClose } = await open();

  await fireEvent.changeText(field(), '새 제목');
  await fireEvent.press(saveButton());

  expect(screen.queryByText('저장')).toBeNull();
  expect(screen.getByText('취소')).toBeDisabled();
  await fireEvent.press(backdrop());
  expect(onClose.mock.calls).toEqual([]);

  await act(async () => pending.reject(new Error('offline')));

  expect(screen.getByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(saveButton()).toBeEnabled();
  expect(onClose.mock.calls).toEqual([]);
});

test('실패 뒤 다른 대본으로 열면 그 제목으로 바뀌고 오류를 걷는다', async () => {
  update.mockRejectedValue(new Error('offline'));
  const { onClose, view } = await open();
  await fireEvent.changeText(field(), '새 제목');
  await fireEvent.press(saveButton());
  expect(screen.getByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeOnTheScreen();

  await view.rerender(<TitleEditDialog script={{ id: 's3', title: '빈 교실' }} onClose={onClose} />);

  expect(field()).toHaveDisplayValue('빈 교실');
  expect(screen.queryByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeNull();
});

test('카드 안을 눌러도 닫히지 않고, 취소·배경·뒤로 가기는 저장 없이 닫는다', async () => {
  const { onClose } = await open();

  await fireEvent.press(screen.getByText('제목 수정'), inside);
  expect(onClose.mock.calls).toEqual([]);

  await fireEvent.press(screen.getByText('취소'));
  await fireEvent.press(backdrop());
  await fireEvent(modal(), 'requestClose');

  expect(onClose.mock.calls).toEqual([[false], [false], [false]]);
  expect(update.mock.calls).toEqual([]);
});

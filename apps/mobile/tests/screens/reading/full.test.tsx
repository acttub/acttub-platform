import { fireEvent, render, screen } from '@testing-library/react-native';

import ReadingFull from '@/app/reading/full';
import { resetReadingState, updateCurrent } from '@/lib/reading/store';

import { openFixtureScript, scriptDetail, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

beforeEach(() => mockReplace.mockClear());

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingFull />);

  expect(screen.getByText('대본이 없어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockReplace).toHaveBeenCalledWith('/reading');
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
  await fireEvent.press(screen.getByText('취소'));

  expect(screen.queryByText('저장')).not.toBeOnTheScreen();
  expect(server.patchLine).not.toHaveBeenCalled();
});

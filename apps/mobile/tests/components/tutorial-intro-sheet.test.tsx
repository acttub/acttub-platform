import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TutorialIntroSheet } from '@/components/tutorial-intro-sheet';
import { logEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const log = logEvent as jest.Mock;

beforeEach(() => {
  log.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

const sheet = () => screen.queryByLabelText('연습 둘러보기 시작');
const modal = () => screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];

test('연습 시트는 두 길을 권하고, 고른 길을 알리며 한 번만 센다', async () => {
  const onChoose = jest.fn();
  await render(<TutorialIntroSheet visible onChoose={onChoose} />);

  expect(screen.getByText('처음이라면')).toBeOnTheScreen();
  expect(screen.getByText('연습 한 바퀴를 직접 돌아볼까요?')).toBeOnTheScreen();
  expect(log.mock.calls).toEqual([['tutorial_intro_shown', { track: 'practice' }]]);

  await fireEvent.press(screen.getByRole('button', { name: '내 영상으로 해 보기' }));
  await fireEvent.press(screen.getByRole('button', { name: '예시 영상으로 둘러보기' }));

  expect(onChoose.mock.calls).toEqual([['own'], ['sample']]);
  expect(log.mock.calls).toEqual([
    ['tutorial_intro_shown', { track: 'practice' }],
    ['tutorial_intro_choice', { mode: 'own', track: 'practice', via: 'button' }],
  ]);
});

test('리딩 시트는 대본 문구로 바뀌고, 예시를 고르면 sample 로 알린다', async () => {
  const onChoose = jest.fn();
  await render(<TutorialIntroSheet visible track="reading" onChoose={onChoose} />);

  expect(screen.getByText('대본 리딩 한 바퀴 해볼까요?')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '내 대본으로 해 보기' })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '예시 대본으로 둘러보기' }));

  expect(onChoose.mock.calls).toEqual([['sample']]);
  expect(log.mock.calls).toEqual([
    ['tutorial_intro_shown', { track: 'reading' }],
    ['tutorial_intro_choice', { mode: 'sample', track: 'reading', via: 'button' }],
  ]);
});

test.each([
  ['나중에 버튼', 'button'],
  ['배경', 'backdrop'],
  ['뒤로 가기', 'back'],
] as const)('%s 로 닫으면 later 로 알리고 어디서 닫았는지 남긴다', async (_name, via) => {
  const onChoose = jest.fn();
  await render(<TutorialIntroSheet visible onChoose={onChoose} />);

  if (via === 'back') await fireEvent(modal(), 'requestClose');
  else {
    // 시트가 accessibilityViewIsModal 이라 배경은 화면 읽기에서 빠지지만 손가락으로는 눌린다.
    const backdrop = () => screen.getByLabelText('나중에 할게요', { includeHiddenElements: true });
    await fireEvent.press(via === 'button' ? screen.getByRole('button', { name: '나중에 할게요' }) : backdrop());
  }

  expect(onChoose.mock.calls).toEqual([['later']]);
  expect(log.mock.calls[1]).toEqual(['tutorial_intro_choice', { mode: 'later', track: 'practice', via }]);
});

test('처음부터 닫혀 있으면 아무것도 그리지 않고 보였다고 세지 않는다', async () => {
  await render(<TutorialIntroSheet visible={false} onChoose={jest.fn()} />);

  expect(sheet()).toBeNull();
  expect(log.mock.calls).toEqual([]);
});

test('닫으면 애니메이션이 끝난 뒤 내리고, 다시 열면 새로 센다', async () => {
  jest.useFakeTimers();
  const onChoose = jest.fn();
  const view = await render(<TutorialIntroSheet visible onChoose={onChoose} />);
  await fireEvent.press(screen.getByRole('button', { name: '내 영상으로 해 보기' }));

  await view.rerender(<TutorialIntroSheet visible={false} onChoose={onChoose} />);
  expect(sheet()).toBeOnTheScreen();

  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(sheet()).toBeNull();

  await view.rerender(<TutorialIntroSheet visible onChoose={onChoose} />);
  expect(sheet()).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '예시 영상으로 둘러보기' }));

  expect(log.mock.calls).toEqual([
    ['tutorial_intro_shown', { track: 'practice' }],
    ['tutorial_intro_choice', { mode: 'own', track: 'practice', via: 'button' }],
    ['tutorial_intro_shown', { track: 'practice' }],
    ['tutorial_intro_choice', { mode: 'sample', track: 'practice', via: 'button' }],
  ]);
});

test('닫는 도중 다시 열면 늦게 온 닫기 끝 알림이 시트를 내리지 않는다', async () => {
  jest.useFakeTimers();
  const view = await render(<TutorialIntroSheet visible onChoose={jest.fn()} />);

  await view.rerender(<TutorialIntroSheet visible={false} onChoose={jest.fn()} />);
  await view.rerender(<TutorialIntroSheet visible onChoose={jest.fn()} />);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });

  expect(sheet()).toBeOnTheScreen();
});

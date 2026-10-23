import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { StyleSheet } from 'react-native';

import { SpotlightGuide, SpotlightHost, type SpotlightStep } from '@/components/spotlight-guide';
import { logEvent } from '@/lib/analytics';
import { clearTargetRect, registerMeasure, setTargetRect, TARGET } from '@/lib/spotlight-targets';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const log = logEvent as jest.Mock;

const STEPS: SpotlightStep[] = [
  { target: TARGET.homeStart, text: 'guide.spotHomeStart' },
  { target: TARGET.shoot, text: 'guide.spotShoot', round: true },
];
const HOME_START = { x: 20, y: 300, width: 200, height: 60 };
const SHOOT = { x: 170, y: 780, width: 56, height: 56 };

// 앱처럼 루트의 그리는 쪽이 먼저 있고, 화면이 그 위에 가이드를 맡긴다.
function App({ visible = true, steps = STEPS, onDone }: { visible?: boolean; steps?: SpotlightStep[]; onDone: (how: 'skip' | 'done') => void }) {
  return (
    <>
      <SpotlightHost />
      <SpotlightGuide visible={visible} steps={steps} topic="home" onDone={onDone} />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  clearTargetRect(TARGET.homeStart);
  clearTargetRect(TARGET.shoot);
});

test('단계마다 설명과 진행을 보이고, 다음·알겠어요로 끝까지 가면 done 으로 끝난다', async () => {
  setTargetRect(TARGET.homeStart, HOME_START);
  setTargetRect(TARGET.shoot, SHOOT);
  const onDone = jest.fn();
  await render(<App onDone={onDone} />);

  expect(screen.getByText('액티 · 1/2')).toBeOnTheScreen();
  expect(screen.getByText('여기서 연습을 시작해요')).toBeOnTheScreen();
  expect(screen.getByText('찍어 둔 연기 영상을 올리면 질문으로 되짚어 주고, 다음 테이크에서 해볼 한 가지를 남겨요.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  expect(screen.getByText('액티 · 2/2')).toBeOnTheScreen();
  expect(screen.getByText('코칭은 여기서 시작해요')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '다음' })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '알겠어요' }));

  expect(onDone.mock.calls).toEqual([['done']]);
  expect(log.mock.calls).toEqual([['spotlight_finish', { topic: 'home', how: 'done', at: 1 }]]);
});

test('비친 자리를 누르면 다음 단계로 넘어간다', async () => {
  setTargetRect(TARGET.homeStart, HOME_START);
  setTargetRect(TARGET.shoot, SHOOT);
  const onDone = jest.fn();
  await render(<App onDone={onDone} />);

  await fireEvent.press(screen.getByRole('button', { name: '여기서 연습을 시작해요' }));
  expect(screen.getByText('액티 · 2/2')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '코칭은 여기서 시작해요' }));
  expect(onDone.mock.calls).toEqual([['done']]);
});

test('건너뛰기를 누르면 그 단계에서 skip 으로 끝난다', async () => {
  setTargetRect(TARGET.homeStart, HOME_START);
  const onDone = jest.fn();
  await render(<App onDone={onDone} />);

  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  await fireEvent.press(screen.getByRole('button', { name: '건너뛰기' }));

  expect(onDone.mock.calls).toEqual([['skip']]);
  expect(log.mock.calls).toEqual([['spotlight_finish', { topic: 'home', how: 'skip', at: 1 }]]);
});

test('자리를 아직 못 쟀으면 설명만 보이고 누를 구멍이 없다가, 자리가 잡히면 비춘다', async () => {
  await render(<App onDone={jest.fn()} />);

  expect(screen.getByText('여기서 연습을 시작해요')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '여기서 연습을 시작해요' })).not.toBeOnTheScreen();

  await act(async () => setTargetRect(TARGET.homeStart, HOME_START));

  expect(screen.getByRole('button', { name: '여기서 연습을 시작해요' })).toBeOnTheScreen();
});

test('띄우는 순간과 한 박자 뒤에 비출 자리를 다시 잰다', async () => {
  let measured = 0;
  const unregister = registerMeasure(TARGET.homeStart, () => {
    measured += 1;
    setTargetRect(TARGET.homeStart, { ...HOME_START, y: HOME_START.y + measured });
  });
  try {
    await render(<App onDone={jest.fn()} />);

    expect(measured).toBe(1);
    expect(screen.getByRole('button', { name: '여기서 연습을 시작해요' })).toBeOnTheScreen();
    await waitFor(() => expect(measured).toBe(2));
  } finally {
    unregister();
  }
});

test('가이드를 내리면 사라지고, 다시 띄우면 첫 단계부터 보인다', async () => {
  setTargetRect(TARGET.homeStart, HOME_START);
  const onDone = jest.fn();
  const view = await render(<App onDone={onDone} />);
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(screen.getByText('액티 · 2/2')).toBeOnTheScreen();

  await view.rerender(<App visible={false} onDone={onDone} />);
  expect(screen.queryByText('코칭은 여기서 시작해요')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();

  await view.rerender(<App onDone={onDone} />);
  expect(screen.getByText('액티 · 1/2')).toBeOnTheScreen();
  expect(screen.getByText('여기서 연습을 시작해요')).toBeOnTheScreen();
});

test('단계가 없으면 띄우지 않는다', async () => {
  const onDone = jest.fn();
  const view = await render(<App steps={[]} onDone={onDone} />);
  expect(screen.toJSON()).toBeNull();

  await view.rerender(<App steps={[STEPS[0]]} onDone={onDone} />);
  expect(screen.getByText('액티 · 1/1')).toBeOnTheScreen();
});

test('onDone 이 새 함수로 바뀌어도 가이드를 다시 띄우지 않고 끝날 때 마지막 것을 부른다', async () => {
  setTargetRect(TARGET.homeStart, HOME_START);
  const first = jest.fn();
  const latest = jest.fn();
  const view = await render(<App onDone={first} />);
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  await view.rerender(<App onDone={latest} />);
  expect(screen.getByText('액티 · 2/2')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '알겠어요' }));
  expect(first.mock.calls).toEqual([]);
  expect(latest.mock.calls).toEqual([['done']]);
});

describe('덮개와 설명 카드 자리', () => {
  const nativeMethods = jest.requireActual('react-native/jest/MockNativeMethods').default as { measureInWindow: jest.Mock };

  afterEach(() => nativeMethods.measureInWindow.mockReset());

  // 카드 = 건너뛰기 글자 → 버튼 → 진행 줄 → 말풍선 글 묶음 → 말풍선 → 카드(액티 + 말풍선, pen 첫 연습 끝 홈 안내).
  // 덮개 판은 카드의 부모다.
  const caption = () => screen.getByText('건너뛰기').parent!.parent!.parent!.parent!.parent!;
  const overlay = () => caption().parent!;
  const captionPlace = () => {
    const { top, bottom } = StyleSheet.flatten(caption().props.style);
    return { top, bottom };
  };

  test('카드는 비출 자리 바로 아래에 두고, 재 보니 커서 아래가 모자라면 화면 안으로 올린다', async () => {
    setTargetRect(TARGET.homeStart, HOME_START);
    await render(<App steps={[STEPS[0]]} onDone={jest.fn()} />);

    // 구멍은 자리보다 8씩 넓다(292~368). 그 아래 16 띄운 384 에 붙는다.
    expect(captionPlace()).toEqual({ top: 384, bottom: undefined });

    await fireEvent.layout(caption(), { height: 1000 });

    // 창 높이 1334 — 아래로는 넘치고 위로도 모자라 화면 안(1334 - 1000)으로 올린다.
    expect(captionPlace()).toEqual({ top: 334, bottom: undefined });
  });

  test('덮개 판의 원점이 창 기준과 다르면 그 차이만큼 구멍과 카드를 옮긴다', async () => {
    nativeMethods.measureInWindow.mockImplementation((callback: (x: number, y: number) => void) => callback(0, -28));
    setTargetRect(TARGET.homeStart, HOME_START);
    await render(<App steps={[STEPS[0]]} onDone={jest.fn()} />);

    await fireEvent.layout(overlay(), { width: 750, height: 1334 });

    expect(captionPlace()).toEqual({ top: 412, bottom: undefined });
  });

  test('판의 원점을 재지 못하면(숫자가 아니면) 창 기준 그대로 둔다', async () => {
    nativeMethods.measureInWindow.mockImplementation((callback: (x: number, y: number) => void) => callback(NaN, NaN));
    setTargetRect(TARGET.homeStart, HOME_START);
    await render(<App steps={[STEPS[0]]} onDone={jest.fn()} />);

    await fireEvent.layout(overlay(), { width: 750, height: 1334 });

    expect(captionPlace()).toEqual({ top: 384, bottom: undefined });
  });

  test('어두운 곳에 닿은 손가락은 덮개가 받아 아래 화면에 가지 않는다', async () => {
    setTargetRect(TARGET.homeStart, HOME_START);
    await render(<App steps={[STEPS[0]]} onDone={jest.fn()} />);

    expect(await fireEvent(overlay(), 'startShouldSetResponder')).toBe(true);
  });
});

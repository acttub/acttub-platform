import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { remeasureTargets, targetRect } from '@/lib/spotlight-targets';

let frames: Array<() => void>;
let cancelled: number[];
let measured: [number, number, number, number];
beforeEach(() => {
  frames = [];
  cancelled = [];
  measured = [10, 20, 100, 40];
  let nextId = 0;
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => {
    frames.push(() => cb(0));
    nextId += 1;
    return nextId;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { cancelled.push(id as number); });
});
const runFrames = () => act(async () => { const pending = frames; frames = []; pending.forEach(fn => fn()); });

let target: ReturnType<typeof useSpotlightTarget>;
function Host({ id }: { id: string }) {
  target = useSpotlightTarget(id);
  return <View ref={target.ref} onLayout={target.onLayout} />;
}
const attachMeasure = () => {
  target.ref.current = {
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(...measured),
  } as never;
};

test('배치가 끝나면 한 프레임 뒤에 창 기준 자리를 적고, 내려가면 지운다', async () => {
  const view = await render(<Host id="home.card" />);
  attachMeasure();

  await act(async () => target.onLayout());
  expect(targetRect('home.card')).toBeNull();
  await runFrames();
  expect(targetRect('home.card')).toEqual({ x: 10, y: 20, width: 100, height: 40 });

  await view.unmount();
  expect(targetRect('home.card')).toBeNull();
});

test('아직 자리를 못 잡은 0,0이나 크기 0은 적지 않는다', async () => {
  await render(<Host id="tab.record" />);
  attachMeasure();

  measured = [0, 0, 50, 50];
  await act(async () => target.onLayout());
  await runFrames();
  expect(targetRect('tab.record')).toBeNull();

  measured = [5, 5, 0, 10];
  await act(async () => target.onLayout());
  await runFrames();
  expect(targetRect('tab.record')).toBeNull();
});

test('가이드가 열릴 때 다시 재고, 연달아 재면 앞 프레임을 취소한다', async () => {
  const view = await render(<Host id="coach.box" />);
  attachMeasure();

  await act(async () => { remeasureTargets(); target.onLayout(); });
  expect(cancelled).toEqual([1]);
  await runFrames();
  expect(targetRect('coach.box')).toEqual({ x: 10, y: 20, width: 100, height: 40 });

  await act(async () => target.onLayout());
  await view.unmount();
  expect(cancelled).toEqual([1, 3]);
});

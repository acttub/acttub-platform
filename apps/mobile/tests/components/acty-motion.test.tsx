import { render, screen } from '@testing-library/react-native';

import { ActyMotion } from '@/components/ui/acty-motion';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';

function sources() {
  return [screen.queryByTestId('m-intro'), screen.queryByTestId('m-pose')].filter(Boolean).flatMap((node) => [node!.props.source].flat());
}

describe('ActyMotion', () => {
  it('완료 축하는 「깜짝 놀람」을 먼저 깔고 그 화면 자세로 바뀐다', async () => {
    await render(<ActyMotion testID="m" source={MASCOT.jump} size={MASCOT_SIZE.xl} kind="celebrate" />);
    expect(sources()).toEqual([MASCOT.surprised, MASCOT.jump]);
  });

  it('생각 중·멈춤은 그 자세 하나만 그린다', async () => {
    const { rerender } = await render(<ActyMotion testID="m" source={MASCOT.coach} size={MASCOT_SIZE.chat} kind="think" />);
    expect(sources()).toEqual([MASCOT.coach]);
    await rerender(<ActyMotion testID="m" source={MASCOT.flat} size={MASCOT_SIZE.xl} kind="none" />);
    expect(sources()).toEqual([MASCOT.flat]);
  });

  it('받은 크기를 그대로 차지해 화면 배치를 바꾸지 않는다', async () => {
    await render(<ActyMotion testID="m" source={MASCOT.jump} size={MASCOT_SIZE.xl} kind="celebrate" />);
    expect(screen.getByTestId('m').props.style).toEqual(MASCOT_SIZE.xl);
  });
});

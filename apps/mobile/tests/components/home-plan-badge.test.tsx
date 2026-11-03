import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomePlanBadge } from '@/components/home-plan-badge';

describe('HomePlanBadge', () => {
  it('Pro 면 PRO 와 구독 관리 안내를 보이고, 누르면 onPress 를 부른다', async () => {
    const onPress = jest.fn();
    await render(<HomePlanBadge plan="pro" onPress={onPress} />);
    expect(screen.getByText('PRO')).toBeTruthy();
    expect(screen.getByLabelText('지금 Pro 이용 중 · 구독 관리')).toBeTruthy();
    fireEvent.press(screen.getByTestId('home-plan-badge'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('무료면 FREE 와 Pro 알아보기 안내를 보인다', async () => {
    await render(<HomePlanBadge plan="free" onPress={jest.fn()} />);
    expect(screen.getByText('FREE')).toBeTruthy();
    expect(screen.queryByText('PRO')).toBeNull();
    expect(screen.getByLabelText('지금 무료 이용 중 · Pro 알아보기')).toBeTruthy();
  });
});

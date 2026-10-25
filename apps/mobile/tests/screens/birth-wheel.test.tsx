import { fireEvent, render, screen } from '@testing-library/react-native';

import { BirthWheel } from '@/components/birth-wheel';

test('생년월일 휠은 안쪽 스크롤을 먼저 받고, 만지는 동안 바깥 화면 스크롤을 멈추라고 알린다(10/25)', async () => {
  const active = jest.fn();
  await render(<BirthWheel value={{ year: 2000, month: 5, day: 10 }} years={[1999, 2000, 2001]} onChange={jest.fn()} onTouchActive={active} />);

  for (const id of ['birth-year', 'birth-month', 'birth-day']) {
    const wheel = screen.getByTestId(id);
    expect(wheel.props.nestedScrollEnabled).toBe(true);
    await fireEvent(wheel, 'touchStart');
    expect(active).toHaveBeenLastCalledWith(true);
    await fireEvent(wheel, 'touchEnd');
    expect(active).toHaveBeenLastCalledWith(false);
  }
});

test('값은 칸에 붙은 뒤에만 고른다 — 손을 뗄 때 고르면 칸 맞춤이 끊긴다', async () => {
  const onChange = jest.fn();
  await render(<BirthWheel value={{ year: 2000, month: 5, day: 10 }} years={[1999, 2000, 2001]} onChange={onChange} />);
  const month = screen.getByTestId('birth-month');
  await fireEvent(month, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 0, y: 44 * 6 } } });
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent(month, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0, y: 44 * 6 } } });
  expect(onChange).toHaveBeenCalledWith({ year: 2000, month: 7, day: 10 });
});

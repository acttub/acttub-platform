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

test('천천히 놓아 관성이 없어도 가운데 값을 고른다', async () => {
  const onChange = jest.fn();
  await render(<BirthWheel value={{ year: 2000, month: 5, day: 10 }} years={[1999, 2000, 2001]} onChange={onChange} />);
  await fireEvent(screen.getByTestId('birth-month'), 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 0, y: 44 * 6 } } });
  expect(onChange).toHaveBeenCalled();
});

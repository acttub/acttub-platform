import { fireEvent, render, screen } from '@testing-library/react-native';

import { LaunchSplashScreen } from '@/components/launch-splash-screen';

test('워드마크와 태그라인을 보이고, 처음 그려지면 네이티브 스플래시를 닫으라고 알린다', async () => {
  const onShown = jest.fn();
  await render(<LaunchSplashScreen onShown={onShown} />);
  expect(screen.getByLabelText('Acttub')).toBeOnTheScreen();
  expect(screen.getByText('오늘도 한 걸음, 같이 연습해요')).toBeOnTheScreen();

  await fireEvent(screen.getByTestId('launch-splash'), 'layout', { nativeEvent: { layout: {} } });
  expect(onShown).toHaveBeenCalled();
});

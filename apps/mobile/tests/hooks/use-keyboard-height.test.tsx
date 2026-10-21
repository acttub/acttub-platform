import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, Keyboard, Platform, Text } from 'react-native';

import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

function Host() {
  return <Text>{`height:${useKeyboardHeight()}`}</Text>;
}

let handlers: Record<string, (event?: unknown) => void>;
let removed: string[];
beforeEach(() => {
  handlers = {};
  removed = [];
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: (event?: unknown) => void) => {
    handlers[name] = handler;
    return { remove: () => removed.push(name) };
  }) as never);
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 400, height: 800, scale: 2, fontScale: 1 });
});

const original = Platform.OS;
afterEach(() => { Platform.OS = original; });

test('iOS는 키보드가 뜨기 직전 높이를 받고 내려가면 0으로 돌아간다', async () => {
  Platform.OS = 'ios';
  const view = await render(<Host />);
  expect(screen.getByText('height:0')).toBeOnTheScreen();

  await act(async () => handlers.keyboardWillShow({ endCoordinates: { height: 300, screenY: 480 } }));
  expect(screen.getByText('height:320')).toBeOnTheScreen();

  await act(async () => handlers.keyboardWillHide());
  expect(screen.getByText('height:0')).toBeOnTheScreen();

  await view.unmount();
  expect(removed.sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);
});

test('안드로이드는 키보드가 뜬 뒤의 이벤트를 듣는다', async () => {
  Platform.OS = 'android';
  await render(<Host />);

  await act(async () => handlers.keyboardDidShow({ endCoordinates: { height: 250, screenY: 600 } }));
  expect(screen.getByText('height:250')).toBeOnTheScreen();

  await act(async () => handlers.keyboardDidHide());
  expect(screen.getByText('height:0')).toBeOnTheScreen();
});

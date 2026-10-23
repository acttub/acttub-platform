import type * as RNTL from '@testing-library/react-native/pure';
import type { ComponentType } from 'react';

let mockAndroidPackage: string | undefined;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { android: { package: mockAndroidPackage } };
    },
  },
}));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));

type Loaded = { lib: typeof RNTL; RN: typeof import('react-native'); Screen: ComponentType };

function load(os: 'ios' | 'android', iosUrl: string | undefined, androidPackage?: string): Loaded {
  mockAndroidPackage = androidPackage;
  if (iosUrl === undefined) delete process.env.EXPO_PUBLIC_IOS_APP_STORE_URL;
  else process.env.EXPO_PUBLIC_IOS_APP_STORE_URL = iosUrl;
  let loaded!: Loaded;
  const react = jest.requireActual('react');
  jest.isolateModules(() => {
    jest.doMock('react', () => react);
    const RN = require('react-native');
    RN.Platform.OS = os;
    loaded = { lib: require('@testing-library/react-native/pure'), RN, Screen: require('@/app/update-required').default };
  });
  current = loaded.lib;
  return loaded;
}

let current: typeof RNTL | undefined;

afterEach(async () => {
  await current?.cleanup();
  current = undefined;
  delete process.env.EXPO_PUBLIC_IOS_APP_STORE_URL;
});

test('iOS 스토어 주소가 있으면 업데이트 버튼이 그 주소를 연다', async () => {
  const { lib, RN, Screen } = load('ios', 'https://apps.apple.com/app/id123');
  const openURL = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(true);
  await lib.render(<Screen />);

  expect(lib.screen.getAllByText('새 버전으로 업데이트해 주세요')).toHaveLength(1);
  await lib.fireEvent.press(lib.screen.getByRole('button', { name: '업데이트' }));

  expect(openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id123');
  expect(lib.screen.queryAllByText('스토어를 열지 못했어요. 스토어에서 Acttub을 직접 찾아주세요.')).toHaveLength(0);
});

test('스토어를 열지 못하면 직접 찾으라고 안내한다', async () => {
  const { lib, RN, Screen } = load('ios', 'https://apps.apple.com/app/id123');
  jest.spyOn(RN.Linking, 'openURL').mockRejectedValue(new Error('no handler'));
  await lib.render(<Screen />);

  await lib.fireEvent.press(lib.screen.getByRole('button', { name: '업데이트' }));

  expect(await lib.screen.findAllByText('스토어를 열지 못했어요. 스토어에서 Acttub을 직접 찾아주세요.')).toHaveLength(1);
});

test('안드로이드는 패키지 이름으로 플레이 스토어 주소를 만든다', async () => {
  const { lib, RN, Screen } = load('android', undefined, 'com.acttub.app');
  const openURL = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(true);
  await lib.render(<Screen />);

  await lib.fireEvent.press(lib.screen.getByRole('button', { name: '업데이트' }));

  expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.acttub.app');
});

test('스토어 주소를 모르면 버튼 없이 직접 업데이트하라고 안내한다', async () => {
  const { lib, Screen } = load('ios', undefined);
  await lib.render(<Screen />);

  expect(lib.screen.getAllByText('스토어에서 Acttub을 찾아 업데이트해주세요.')).toHaveLength(1);
  expect(lib.screen.queryAllByRole('button')).toHaveLength(0);
});

test('하드웨어 뒤로 가기를 막고, 화면을 떠나면 막기를 푼다', async () => {
  const { lib, RN, Screen } = load('android', undefined, 'com.acttub.app');
  const remove = jest.fn();
  let handler: (() => boolean | null | undefined) | undefined;
  jest.spyOn(RN.BackHandler, 'addEventListener').mockImplementation((event, fn) => {
    expect(event).toBe('hardwareBackPress');
    handler = fn;
    return { remove };
  });
  const view = await lib.render(<Screen />);

  expect(handler?.()).toBe(true);
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

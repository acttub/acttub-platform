import { act, fireEvent, render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { recordHandledError } from '@/lib/crashlytics';
import { lastProviderStore } from '@/lib/last-provider';
import { supportedProviders } from '@/lib/provider-sdk';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/api', () => ({ api: { authProviders: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/crashlytics', () => ({ recordHandledError: jest.fn() }));
jest.mock('@/lib/last-provider', () => ({ lastProviderStore: { read: jest.fn() } }));
jest.mock('@/lib/provider-sdk', () => ({ supportedProviders: jest.fn() }));

const authProviders = api.authProviders as jest.Mock;
const signInWith = jest.fn();
const clearLoginNotice = jest.fn();

function auth(loginNotice: unknown = null) {
  (useAuth as jest.Mock).mockReturnValue({ signInWith, loginNotice, clearLoginNotice });
}

beforeEach(() => {
  jest.clearAllMocks();
  auth();
  authProviders.mockResolvedValue({ providers: ['google', 'apple', 'kakao', 'naver'] });
  (supportedProviders as jest.Mock).mockResolvedValue(['google', 'apple', 'kakao']);
  (lastProviderStore.read as jest.Mock).mockResolvedValue(null);
});

test('서버가 켜고 이 빌드가 지원하는 제공자 버튼만 그린다', async () => {
  await render(<LoginScreen />);

  expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeOnTheScreen();
  expect(screen.getByText('다른 방법으로 계속하기')).toBeOnTheScreen();
  expect(screen.getByText('그 장면에서 뭘 하려 했는지부터')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Apple로 로그인/ })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Apple로 로그인/ })).toHaveStyle({ width: 56, height: 56, borderRadius: 28 });
  expect(screen.getByRole('button', { name: /카카오로 계속하기/ })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /네이버로 계속하기/ })).not.toBeOnTheScreen();
  
});

test('지난번에 쓴 제공자는 접근성 이름에만 표시한다(화면에는 「최근 로그인」 배지)', async () => {
  (lastProviderStore.read as jest.Mock).mockResolvedValue('kakao');
  await render(<LoginScreen />);

  expect(await screen.findByRole('button', { name: '카카오로 계속하기, 지난번에 쓴 방식' })).toBeOnTheScreen();
});

test('버튼을 누르면 그 제공자로 로그인하고 그동안 다른 버튼을 막는다', async () => {
  let finish!: () => void;
  signInWith.mockReturnValue(new Promise<void>((r) => (finish = r)));
  await render(<LoginScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: /Google로 계속하기/ }));

  expect(signInWith).toHaveBeenCalledWith('google');
  expect(clearLoginNotice).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /카카오로 계속하기/ })).toBeDisabled();

  await act(async () => finish());
  expect(screen.getByRole('button', { name: /카카오로 계속하기/ })).toBeEnabled();
  expect(screen.queryByText('로그인에 실패했어요. 다시 시도해 주세요.')).not.toBeOnTheScreen();
});

test('로그인이 실패하면 한 문장만 보이고 원인은 크래시 리포트에 남긴다', async () => {
  const err = new Error('cancelled');
  signInWith.mockRejectedValue(err);
  await render(<LoginScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: /카카오로 계속하기/ }));

  expect(await screen.findByText('로그인에 실패했어요. 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(recordHandledError).toHaveBeenCalledWith(err);
  expect(authProviders).toHaveBeenCalledTimes(1);
});

test('꺼 둔 제공자였으면 목록을 다시 받아 버튼을 새로 그린다', async () => {
  signInWith.mockRejectedValue(Object.assign(new Error('off'), { code: 'unsupported_provider' }));
  await render(<LoginScreen />);
  authProviders.mockResolvedValue({ providers: ['google'] });

  await fireEvent.press(await screen.findByRole('button', { name: /카카오로 계속하기/ }));

  expect(await screen.findByText('로그인에 실패했어요. 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(authProviders).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: /카카오로 계속하기/ })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Google로 계속하기/ })).toBeOnTheScreen();
});

test('목록을 못 받으면 다시 불러오기를 둔다', async () => {
  authProviders.mockRejectedValueOnce(new Error('down'));
  await render(<LoginScreen />);

  expect(await screen.findByText('로그인 방식을 불러오지 못했어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));

  expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeOnTheScreen();
});

test('켜진 제공자가 없으면 지금은 로그인할 수 없다고 알린다', async () => {
  authProviders.mockResolvedValue({ providers: ['naver'] });
  await render(<LoginScreen />);
  expect(
    await screen.findByText('지금은 로그인할 수 있는 방식이 없어요. 잠시 후 다시 시도해 주세요.'),
  ).toBeOnTheScreen();
});

test('게이트가 남긴 안내 문구를 보여 준다', async () => {
  auth({ kind: 'notice', message: '세션이 끝나 다시 로그인해 주세요.' });
  await render(<LoginScreen />);
  expect(await screen.findByText('세션이 끝나 다시 로그인해 주세요.')).toBeOnTheScreen();
});

describe('이미 다른 방식으로 가입한 이메일', () => {
  test('그 방식을 이 빌드가 지원하면 그걸로 계속할지 묻고, 받으면 로그인한다', async () => {
    signInWith.mockResolvedValue(undefined);
    auth({ kind: 'email_conflict', provider: 'google' });
    await render(<LoginScreen />);

    expect(await screen.findByText('이 이메일은 Google로 가입돼 있어요.\nGoogle로 계속할까요?')).toBeOnTheScreen();
    expect(clearLoginNotice).toHaveBeenCalled();
    const labels = screen.getAllByText('Google로 계속하기');
    await fireEvent.press(labels[labels.length - 1]);

    expect(signInWith).toHaveBeenCalledWith('google');
  });

  test('닫으면 로그인하지 않는다', async () => {
    auth({ kind: 'email_conflict', provider: 'apple' });
    await render(<LoginScreen />);

    await fireEvent.press(await screen.findByText('닫기'));
    expect(signInWith).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Apple로 로그인/ })).toBeEnabled();
  });

  test('지원하지 않는 방식이면 알리기만 한다', async () => {
    auth({ kind: 'email_conflict', provider: 'naver' });
    await render(<LoginScreen />);

    expect(await screen.findByText('이 이메일은 네이버로 가입돼 있어요.')).toBeOnTheScreen();
    expect(screen.queryByText('닫기')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('확인'));
    expect(screen.queryByText('이 이메일은 네이버로 가입돼 있어요.')).not.toBeOnTheScreen();
    expect(signInWith).not.toHaveBeenCalled();
  });
});

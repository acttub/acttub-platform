import { StackActions, useNavigation } from 'expo-router/react-navigation';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, Stack, Tabs } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Pressable, Text } from 'react-native';

import { useWaitExit } from '@/hooks/use-wait-exit';

let confirm: (() => Promise<boolean>) | undefined;

function Waiting() {
  const leave = useWaitExit(true, '/reading', confirm);
  const navigation = useNavigation();
  return (
    <>
      <Text>기다리는 중</Text>
      <Pressable onPress={leave}>
        <Text>화면 안 뒤로</Text>
      </Pressable>
      <Pressable onPress={() => navigation.dispatch(StackActions.pop())}>
        <Text>머리 뒤로</Text>
      </Pressable>
    </>
  );
}

const routes = {
  _layout: () => <Stack />,
  // SDK 58 탭은 레이아웃에 적은 화면만 보여 준다.
  '(tabs)/_layout': () => (
    <Tabs backBehavior="history">
      <Tabs.Screen name="index" />
      <Tabs.Screen name="reading" />
    </Tabs>
  ),
  '(tabs)/index': () => <Text>홈</Text>,
  '(tabs)/reading': () => <Text>리딩 탭</Text>,
  'reading/new': Waiting,
  'reading/roles': () => <Text>배역 고르기</Text>,
};

async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function openWaiting(start: string) {
  const view = await renderRouter(routes, { initialUrl: start });
  await act(async () => router.push('/reading/new'));
  await settle();
  expect(screen.getByText('기다리는 중')).toBeTruthy();
  return view;
}

beforeEach(() => {
  confirm = undefined;
});

// 막힌 뒤로 가기는 한 번만 이어 간다. SDK 58 에서 막기를 켠 채 같은 이동을 다시 보내면 콜백이 끝없이 돌았다.
describe.each([
  ['안드로이드 뒤로 키·밀어서 나가기(GO_BACK)', () => router.back()],
  ['머리 뒤로 버튼(POP)', () => fireEvent.press(screen.getByText('머리 뒤로'))],
  ['화면 안 뒤로 버튼', () => fireEvent.press(screen.getByText('화면 안 뒤로'))],
])('%s', (_name, goBack) => {
  test.each(['/reading', '/'])('%s 에서 들어와도 리딩 탭 첫 화면으로 간다', async (start) => {
    const view = await openWaiting(start);

    await act(async () => goBack());
    await settle();

    expect(view.getPathname()).toBe('/reading');
    expect(screen.getByText('리딩 탭')).toBeTruthy();
  });
});

test('나가기 전에 묻고 남기로 하면 기다림 화면에 남는다', async () => {
  confirm = async () => false;
  const view = await openWaiting('/reading');

  await act(async () => router.back());
  await settle();

  expect(view.getPathname()).toBe('/reading/new');
});

test('뒤로 가기가 아닌 이동(다 끝나서 넘어가는 replace)은 그대로 보낸다', async () => {
  const view = await openWaiting('/reading');

  await act(async () => router.replace('/reading/roles'));
  await settle();

  expect(view.getPathname()).toBe('/reading/roles');
});

// 11/2 QA: 프로필·홈에서 하던 코칭을 바로 열었다가 뒤로 가면 코칭 탭이 아니라 들어온 탭으로 돌아간다(backToTabBelow).
function CoachWaitingLike() {
  useWaitExit(true, '/coaching', undefined, { backToTabBelow: true });
  return <Text>코치 기다리는 중</Text>;
}

test('backToTabBelow: 바로 아래가 탭이면 들어온 탭으로 돌아간다', async () => {
  const view = await renderRouter(
    {
      _layout: () => <Stack />,
      '(tabs)/_layout': () => (
        <Tabs backBehavior="history">
          <Tabs.Screen name="index" />
          <Tabs.Screen name="profile" />
          <Tabs.Screen name="coaching" />
        </Tabs>
      ),
      '(tabs)/index': () => <Text>홈</Text>,
      '(tabs)/profile': () => <Text>프로필</Text>,
      '(tabs)/coaching': () => <Text>코칭 탭</Text>,
      coach: CoachWaitingLike,
    },
    { initialUrl: '/profile' },
  );
  await act(async () => router.push('/coach'));
  await settle();
  expect(screen.getByText('코치 기다리는 중')).toBeTruthy();
  await act(async () => router.back());
  await settle();
  expect(view.getPathname()).toBe('/profile');
});

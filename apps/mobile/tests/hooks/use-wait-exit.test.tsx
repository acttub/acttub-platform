import { StackActions, useNavigation, usePreventRemoveContext, useRoute } from '@react-navigation/native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, Stack, Tabs, useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Pressable, Text } from 'react-native';

import { useWaitExit } from '@/hooks/use-wait-exit';

// 기다림 화면이 막기(preventRemove)를 몇 번 바꿨는지 남긴다. native-stack 은 이 값이 바뀌면 그 화면의 머리(헤더) 속성을 바꾼다.
let prevented: boolean[] = [];

function PreventProbe() {
  const { key } = useRoute();
  const value = usePreventRemoveContext().preventedRoutes[key]?.preventRemove ?? false;
  if (prevented[prevented.length - 1] !== value) prevented.push(value);
  return null;
}

let confirm: (() => Promise<boolean>) | undefined;

function Waiting() {
  const leave = useWaitExit(true, '/practice?mode=reading', confirm);
  const navigation = useNavigation();
  return (
    <>
      <PreventProbe />
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

// 연습 탭 — 주소의 mode 로 리딩·코칭 중 어느 쪽이 열렸는지 보인다.
function PracticeTabLike() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <Text>{`연습 탭 ${mode ?? ''}`}</Text>;
}

const routes = {
  _layout: () => <Stack />,
  '(tabs)/_layout': () => <Tabs backBehavior="history" />,
  '(tabs)/index': () => <Text>홈</Text>,
  '(tabs)/practice': PracticeTabLike,
  'reading/new': Waiting,
  'reading/roles': () => <Text>배역 고르기</Text>,
};

async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function openWaiting(start: string) {
  const view = renderRouter(routes, { initialUrl: start });
  await view;
  await act(async () => router.push('/reading/new'));
  await settle();
  expect(screen.getByText('기다리는 중')).toBeTruthy();
  // renderRouter 의 결과는 then 을 가진 객체라 그대로 돌려주면 await 가 풀어 버린다.
  return { getPathname: () => view.getPathname() };
}

beforeEach(() => {
  prevented = [];
  confirm = undefined;
});

// SOMA-972: 나가면서 막기를 풀면 native-stack 이 헤더 속성을 바꾸고, 그 갱신이 화면 제거와 함께 안드로이드에 닿으면
// react-native-screens 가 "ScreenStackFragment added into a non-stack container" 로 앱을 끈다. 막기는 화면이 사라질 때까지 그대로 둔다.
describe.each([
  ['안드로이드 뒤로 키·밀어서 나가기(GO_BACK)', () => router.back()],
  ['머리 뒤로 버튼(POP)', () => fireEvent.press(screen.getByText('머리 뒤로'))],
  ['화면 안 뒤로 버튼', () => fireEvent.press(screen.getByText('화면 안 뒤로'))],
])('%s', (_name, goBack) => {
  test.each(['/practice?mode=coaching', '/'])('%s 에서 들어와도 막기를 풀지 않고 연습 탭 리딩 첫 화면으로 간다', async (start) => {
    const view = await openWaiting(start);

    await act(async () => goBack());
    await settle();

    expect(view.getPathname()).toBe('/practice');
    expect(screen.getByText('연습 탭 reading')).toBeTruthy();
    expect(prevented).toEqual([false, true]);
  });
});

test('나가기 전에 묻고 남기로 하면 기다림 화면에 남는다', async () => {
  confirm = async () => false;
  const view = await openWaiting('/practice');

  await act(async () => router.back());
  await settle();

  expect(view.getPathname()).toBe('/reading/new');
  expect(prevented).toEqual([false, true]);
});

test('뒤로 가기가 아닌 이동(다 끝나서 넘어가는 replace)은 막기를 풀지 않고 그대로 보낸다', async () => {
  const view = await openWaiting('/practice');

  await act(async () => router.replace('/reading/roles'));
  await settle();

  expect(view.getPathname()).toBe('/reading/roles');
  expect(prevented).toEqual([false, true]);
});

// 11/2 QA: 프로필·홈에서 하던 코칭을 바로 열었다가 뒤로 가면 코칭 탭이 아니라 들어온 탭으로 돌아간다(backToTabBelow).
function CoachWaitingLike() {
  useWaitExit(true, '/practice?mode=coaching', undefined, { backToTabBelow: true });
  return <Text>코치 기다리는 중</Text>;
}

test('backToTabBelow: 바로 아래가 탭이면 들어온 탭으로 돌아간다', async () => {
  const view = renderRouter(
    {
      _layout: () => <Stack />,
      '(tabs)/_layout': () => <Tabs backBehavior="history" />,
      '(tabs)/index': () => <Text>홈</Text>,
      '(tabs)/profile': () => <Text>프로필</Text>,
      '(tabs)/practice': PracticeTabLike,
      coach: CoachWaitingLike,
    },
    { initialUrl: '/profile' },
  );
  await view;
  await act(async () => router.push('/coach'));
  await settle();
  expect(screen.getByText('코치 기다리는 중')).toBeTruthy();
  await act(async () => router.back());
  await settle();
  expect(view.getPathname()).toBe('/profile');
});

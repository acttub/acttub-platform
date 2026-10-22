import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  PracticeFooter,
  ProgressRow,
  SceneFoldBody,
  SceneFoldLink,
  SceneSummary,
  Stepper,
  logFoldOpen,
} from '@/components/practice-chrome';
import { logEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(async () => undefined) }));

// expo-video 는 네이티브 플레이어라, 실제 훅처럼 소스가 바뀔 때마다 플레이어를 새로 만들고 setup 을 부르는 가짜로 바꾼다.
jest.mock('expo-video', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const players: Record<string, unknown>[] = [];
  const makePlayer = (source: unknown) => {
    const listeners: Record<string, Set<(payload: unknown) => void>> = {};
    const player = {
      source,
      loop: true,
      addListener(name: string, fn: (payload: unknown) => void) {
        (listeners[name] ??= new Set()).add(fn);
        return { remove: () => listeners[name].delete(fn) };
      },
      emit(name: string, payload?: unknown) {
        for (const fn of listeners[name] ?? []) fn(payload);
      },
    };
    players.push(player);
    return player;
  };
  return {
    mockPlayers: players,
    useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) =>
      React.useMemo(() => {
        const player = makePlayer(source);
        setup?.(player);
        return player;
      }, [JSON.stringify(source)]),
    VideoView: ({ player }: { player: { source: unknown } }) => React.createElement(RNText, null, `영상 재생기: ${String(player.source)}`),
  };
});

type FakePlayer = { source: unknown; loop: boolean; emit: (name: string, payload?: unknown) => void };
const { mockPlayers } = jest.requireMock('expo-video') as { mockPlayers: FakePlayer[] };
const log = logEvent as jest.Mock;
const lastPlayer = () => mockPlayers[mockPlayers.length - 1];

beforeEach(() => {
  log.mockClear();
  mockPlayers.length = 0;
});

describe('Stepper', () => {
  // pen P/Stepper(SOMA-748) — 지나온 단계도 체크 대신 파란 동그라미에 번호를 둔다. 장면 단계를 뺀 뒤(SOMA-778) 단계 이름은 목적 · 영상 둘이다.
  test('지나온·지금 단계 모두 번호로 보이고, 이름은 진한 14/700(pen 03)', async () => {
    await render(<Stepper current={2} />);
    expect(screen.getByText('목적')).toBeOnTheScreen();
    expect(screen.getByText('영상')).toBeOnTheScreen();
    expect(screen.queryByText('장면 · 질문')).not.toBeOnTheScreen();
    expect(screen.queryByText('✓')).not.toBeOnTheScreen();
    expect(screen.getByText('1')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.queryByText('3')).not.toBeOnTheScreen();
    expect(screen.getByText('영상')).toHaveStyle({ fontSize: 14, fontWeight: '700', color: '#191F28' });
    expect(screen.getByText('목적')).toHaveStyle({ fontWeight: '700', color: '#191F28' });
  });

  test('첫 단계에서는 지나온 단계가 없고 다음 단계는 흐리다', async () => {
    await render(<Stepper current={1} />);
    expect(screen.queryByText('✓')).not.toBeOnTheScreen();
    expect(screen.getByText('1')).toBeOnTheScreen();
    expect(screen.getByText('영상')).toHaveStyle({ color: '#8B95A1' });
  });
});

test('진행 줄은 단계 이름과 오른쪽에 둔 것을 함께 보인다', async () => {
  await render(<ProgressRow label="3단계 · 질문 받기" right={<Text>영상 보기</Text>} />);
  expect(screen.getByText('3단계 · 질문 받기')).toBeOnTheScreen();
  expect(screen.getByText('영상 보기')).toBeOnTheScreen();
});

test('맨 아래 안내 문구를 보인다', async () => {
  await render(<PracticeFooter />);
  expect(screen.getByText('영상에서 눈에 남은 곳을 묻고, 마지막 한 문장은 배우님이 직접 써요.')).toBeOnTheScreen();
});

describe('SceneFoldLink', () => {
  test('접힌 링크를 누르면 펼치고, 어느 화면에서 펼쳤는지 남긴다', async () => {
    const onToggle = jest.fn();
    await render(<SceneFoldLink open={false} onToggle={onToggle} label="영상·장면 보기" track="analyzing" />);
    const link = screen.getByRole('button', { name: '영상·장면 보기 펼치기' });
    expect(link).not.toBeExpanded();
    expect(screen.getByText('영상·장면 보기 ▾')).toBeOnTheScreen();

    await userEvent.setup().press(link);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([['video_fold_open', { screen: 'analyzing' }]]);
  });

  test('펼친 링크를 누르면 접기만 하고 남기지 않는다', async () => {
    const onToggle = jest.fn();
    await render(<SceneFoldLink open onToggle={onToggle} label="영상·장면 보기" track="report" />);
    const link = screen.getByRole('button', { name: '영상·장면 보기 접기' });
    expect(link).toBeExpanded();
    expect(screen.getByText('영상·장면 보기 ▴')).toBeOnTheScreen();

    await fireEvent.press(link);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  test('기록할 화면을 주지 않으면 펼쳐도 남기지 않는다', async () => {
    const onToggle = jest.fn();
    await render(<SceneFoldLink open={false} onToggle={onToggle} label="영상 보기" />);
    await fireEvent.press(screen.getByRole('button', { name: '영상 보기 펼치기' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

test('logFoldOpen 은 화면 이름을 실어 펼침 이벤트를 보낸다', () => {
  logFoldOpen('coach');
  expect(log.mock.calls).toEqual([['video_fold_open', { screen: 'coach' }]]);
});

describe('SceneFoldBody', () => {
  test('접혀 있으면 아무것도 그리지 않고 영상도 걸지 않는다', async () => {
    await render(<SceneFoldBody open={false} videoUri="file:///take.mp4" track="analyzing" />);
    expect(screen.queryByText(/영상 재생기/)).not.toBeOnTheScreen();
    expect(screen.queryByText('다시 볼 수 있는 영상이 없어요.')).not.toBeOnTheScreen();
    expect(lastPlayer().source).toBeNull();
  });

  test('펼치면 영상을 반복 없이 걸고, 처음 틀 때와 끝까지 볼 때를 한 번씩 남긴다', async () => {
    await render(<SceneFoldBody open videoUri="file:///take.mp4" track="analyzing" />);
    expect(screen.getByText('영상 재생기: file:///take.mp4')).toBeOnTheScreen();
    expect(lastPlayer().loop).toBe(false);

    await act(async () => {
      lastPlayer().emit('playingChange', { isPlaying: true });
      lastPlayer().emit('playingChange', { isPlaying: false });
      lastPlayer().emit('playingChange', { isPlaying: true });
      lastPlayer().emit('playToEnd');
    });

    expect(log.mock.calls).toEqual([
      ['video_preview_play', { screen: 'analyzing' }],
      ['video_preview_end', { screen: 'analyzing' }],
    ]);
  });

  test('번들 영상(숫자 에셋)도 영상으로 보고 센다', async () => {
    await render(<SceneFoldBody open videoUri={7} track="coach" />);
    expect(screen.getByText('영상 재생기: 7')).toBeOnTheScreen();
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log.mock.calls).toEqual([['video_preview_play', { screen: 'coach' }]]);
  });

  test.each([
    ['빈 주소', ''],
    ['주소 없음', null],
  ])('%s 이면 영상 대신 없다고 알리고 세지 않는다', async (_, videoUri) => {
    await render(<SceneFoldBody open videoUri={videoUri} track="report" />);
    expect(screen.getByText('다시 볼 수 있는 영상이 없어요.')).toBeOnTheScreen();
    expect(screen.queryByText(/영상 재생기/)).not.toBeOnTheScreen();
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log).not.toHaveBeenCalled();
  });

  test('기록할 화면을 주지 않으면 틀어도 남기지 않는다', async () => {
    await render(<SceneFoldBody open videoUri="file:///take.mp4" />);
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log).not.toHaveBeenCalled();
  });
});

describe('SceneSummary', () => {
  const scene = { situation: '  첫 오디션 날  ', character: '', goal: '떨림을 숨긴다' };

  test('값이 있는 줄만 라벨과 함께 보이고, 막힌 곳의 설명은 따옴표로 보인다', async () => {
    await render(
      <SceneSummary
        scene={scene}
        blockage={{ kind: '감정이 안 올라와요', detail: '  마지막 대사에서 멈춰요 ' }}
        title="분석에 쓰는 내용"
        practiceTitle="햄릿 3막"
      />,
    );
    expect(screen.getByText('분석에 쓰는 내용')).toBeOnTheScreen();
    expect(screen.getByText('연습 제목')).toBeOnTheScreen();
    expect(screen.getByText('햄릿 3막')).toBeOnTheScreen();
    expect(screen.getByText('상황')).toBeOnTheScreen();
    expect(screen.getByText('첫 오디션 날')).toBeOnTheScreen();
    expect(screen.queryByText('인물')).not.toBeOnTheScreen();
    expect(screen.getByText('목표')).toBeOnTheScreen();
    expect(screen.getByText('막힌 곳')).toBeOnTheScreen();
    expect(screen.getByText('감정이 안 올라와요')).toBeOnTheScreen();
    expect(screen.getByText('“마지막 대사에서 멈춰요”')).toBeOnTheScreen();
  });

  test('제목을 주지 않으면 줄만 보이고, 설명이 비어 있으면 따옴표 칸을 두지 않는다', async () => {
    await render(<SceneSummary scene={scene} blockage={{ kind: '대사가 막혀요', detail: '   ' }} />);
    expect(screen.queryByText('분석에 쓰는 내용')).not.toBeOnTheScreen();
    expect(screen.getByText('대사가 막혀요')).toBeOnTheScreen();
    expect(screen.queryByText(/“/)).not.toBeOnTheScreen();
  });

  test('막힌 곳 설명만 있어도 보인다', async () => {
    await render(<SceneSummary scene={{ situation: '', character: '', goal: '' }} blockage={{ kind: '', detail: '숨이 차요' }} />);
    expect(screen.getByText('“숨이 차요”')).toBeOnTheScreen();
    expect(screen.queryByText('막힌 곳')).not.toBeOnTheScreen();
  });

  test('보일 값이 하나도 없으면 아무것도 그리지 않는다', async () => {
    await render(<SceneSummary scene={{ situation: ' ', character: '', goal: '' }} blockage={null} title="분석에 쓰는 내용" />);
    expect(screen.queryByText('분석에 쓰는 내용')).not.toBeOnTheScreen();
  });
});

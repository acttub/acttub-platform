import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { finishTutorial, useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { logEvent } from '@/lib/analytics';
import { markReadingTutorialSeen, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { currentTutorial, endTutorial, startTutorial, type TutorialStage } from '@/lib/tutorial';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/guide-state', () => ({
  markReadingTutorialSeen: jest.fn(async () => undefined),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
}));
// 비추는 그림은 spotlight-guide 시험이 본다. 여기서는 무엇을 언제 비추라고 넘기는지만 본다.
jest.mock('@/components/spotlight-guide', () => {
  const { Text: RNText } = require('react-native');
  return {
    SpotlightGuide: ({ visible, topic, steps, onDone }: {
      visible: boolean; topic: string; steps: { text: string }[]; onDone: (how: 'skip' | 'done') => void;
    }) => visible ? (
      <>
        <RNText>{`${topic}:${steps.map(step => step.text).join(',')}`}</RNText>
        <RNText onPress={() => onDone('skip')}>건너뛰기</RNText>
        <RNText onPress={() => onDone('done')}>다 봤어요</RNText>
      </>
    ) : null,
  };
});

function Host({ stage, ready, onDone }: { stage: TutorialStage; ready?: boolean; onDone?: (how: 'skip' | 'done') => void }) {
  const { active, element } = useTutorialSpotlight(stage, { ready, onDone });
  return <>{element}<Text>{`active:${active}`}</Text></>;
}

beforeEach(() => {
  jest.clearAllMocks();
  endTutorial();
});

test('튜토리얼이 없으면 비추지 않는다', async () => {
  await render(<Host stage="upload" />);
  expect(screen.getByText('active:false')).toBeOnTheScreen();
  expect(screen.queryByText('건너뛰기')).not.toBeOnTheScreen();
  expect(logEvent).not.toHaveBeenCalled();
});

test('같은 갈래의 튜토리얼 중이면 이 화면의 단계를 비추고 기록한다', async () => {
  startTutorial('own');
  await render(<Host stage="upload" />);

  expect(screen.getByText('active:true')).toBeOnTheScreen();
  expect(screen.getByText('tutorial.upload:tutorial.upPick,tutorial.upRights,tutorial.upStart')).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('tutorial_step', { mode: 'own', track: 'practice', stage: 'upload' });
});

test('다른 갈래를 도는 중이면 이 화면은 비추지 않는다', async () => {
  startTutorial('sample', 'reading');
  await render(<Host stage="upload" />);
  expect(screen.getByText('active:false')).toBeOnTheScreen();
});

test('준비되기 전에는 기다렸다가 준비되면 비춘다', async () => {
  startTutorial('own');
  const view = await render(<Host stage="coach" ready={false} />);
  expect(screen.queryByText('건너뛰기')).not.toBeOnTheScreen();

  await view.rerender(<Host stage="coach" ready />);
  expect(screen.getByText('tutorial.coach:tutorial.coQuestion,tutorial.coAnswer')).toBeOnTheScreen();
});

test('다 보면 손을 떼고 튜토리얼은 이어진다', async () => {
  startTutorial('own');
  const onDone = jest.fn();
  await render(<Host stage="report" onDone={onDone} />);

  await fireEvent.press(screen.getByText('다 봤어요'));

  expect(onDone).toHaveBeenCalledWith('done');
  expect(screen.queryByText('다 봤어요')).not.toBeOnTheScreen();
  expect(currentTutorial()).toEqual({ mode: 'own', track: 'practice' });
});

test('건너뛰면 튜토리얼을 끝내고 연습 갈래의 안내를 본 것으로 친다', async () => {
  startTutorial('sample');
  const onDone = jest.fn();
  await render(<Host stage="analyzing" onDone={onDone} />);

  await fireEvent.press(screen.getByText('건너뛰기'));

  expect(onDone).toHaveBeenCalledWith('skip');
  expect(currentTutorial()).toBeNull();
  expect(logEvent).toHaveBeenCalledWith('tutorial_finish', { mode: 'sample', track: 'practice', how: 'skip' });
  expect(markTutorialSeen).toHaveBeenCalledTimes(1);
  expect(markSpotlightSeen).toHaveBeenCalledWith('home');
  expect(markReadingTutorialSeen).not.toHaveBeenCalled();
  expect(screen.getByText('active:false')).toBeOnTheScreen();
});

test('리딩 갈래를 끝내면 리딩 튜토리얼과 리딩 첫 안내를 본 것으로 친다', async () => {
  startTutorial('own', 'reading');
  await act(async () => finishTutorial('done'));

  expect(logEvent).toHaveBeenCalledWith('tutorial_finish', { mode: 'own', track: 'reading', how: 'done' });
  expect(markReadingTutorialSeen).toHaveBeenCalledTimes(1);
  expect(markSpotlightSeen).toHaveBeenCalledWith('reading');
  expect(markTutorialSeen).not.toHaveBeenCalled();
});

test('튜토리얼 중이 아니면 끝내기는 아무것도 남기지 않는다', () => {
  finishTutorial('left');
  expect(logEvent).not.toHaveBeenCalled();
  expect(markSpotlightSeen).not.toHaveBeenCalled();
});

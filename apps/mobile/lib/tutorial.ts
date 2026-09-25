/**
 * 연습 루프를 한 바퀴 직접 돌아보는 튜토리얼 (SOMA-494).
 *
 * <p>슬라이드로 설명을 읽히는 대신, 실제 루프(영상 → 장면 → 분석 → 질문 → 노트)를 한 번
 * 돌게 하고 화면마다 누를 곳을 비춘다. 두 갈래다.
 * <ul>
 *   <li>own — 내 영상으로. 실제 서버 루프를 그대로 탄다. 스포트라이트만 얹는다.
 *   <li>sample — 예시 영상으로. 미리 만든 질문·노트로 돈다({@code lib/tutorial-sample}).
 *       서버를 부르지 않는다 — 비용·게스트 한도·대기가 없다.
 * </ul>
 *
 * <p>여기 있는 건 "지금 튜토리얼 중인가"와 화면별로 비출 자리뿐이다. 예시 연습인지는
 * 여기서 가리지 않는다 — 연습 id 로 가린다({@link isSamplePractice}). 튜토리얼 중에 앱을
 * 벗어나도, 다음 실제 연습이 예시 경로를 타는 일이 없게 하려는 것이다.
 */

import { type SpotlightStep } from './guide-spotlight.ts';
import { TARGET } from './spotlight-targets.ts';

export type TutorialMode = 'own' | 'sample';
/** 어느 루프를 도는가 — AI 연습(영상→질문→노트) 또는 대본 리딩(대본→배역→범위→읽기). */
export type TutorialTrack = 'practice' | 'reading';
type PracticeStage = 'upload' | 'analyzing' | 'coach' | 'report';
type ReadingStage = 'readingNew' | 'readingConfirm' | 'readingRoles' | 'readingRange';
export type TutorialStage = PracticeStage | ReadingStage;

export const TUTORIAL_STAGES: PracticeStage[] = ['upload', 'analyzing', 'coach', 'report'];
/**
 * 대본 리딩은 범위 화면까지 비춘다. 읽기 화면에는 제 첫 안내(R03.0)가 이미 있어 겹치지 않게
 * 거기서 튜토리얼을 마친다.
 */
export const READING_TUTORIAL_STAGES: ReadingStage[] = ['readingNew', 'readingConfirm', 'readingRoles', 'readingRange'];

/** 화면 단계가 어느 갈래의 것인지. 다른 갈래를 도는 중이면 그 화면은 비추지 않는다. */
export function stageTrack(stage: TutorialStage): TutorialTrack {
  return (READING_TUTORIAL_STAGES as TutorialStage[]).includes(stage) ? 'reading' : 'practice';
}

let current: { mode: TutorialMode; track: TutorialTrack } | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function startTutorial(mode: TutorialMode, track: TutorialTrack = 'practice'): void {
  current = { mode, track };
  notify();
}

export function currentTutorial(): { mode: TutorialMode; track: TutorialTrack } | null {
  return current;
}

export function endTutorial(): void {
  if (!current) return;
  current = null;
  notify();
}

export function onTutorialChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 화면마다 비출 자리. 문구는 `<text>Title`·`<text>Body` 를 읽는다. */
export function tutorialSteps(stage: TutorialStage, mode: TutorialMode): SpotlightStep[] {
  switch (stage) {
    case 'upload':
      return mode === 'own'
        ? [
            { target: TARGET.uploadPick, text: 'tutorial.upPick' },
            { target: TARGET.uploadScene, text: 'tutorial.upScene' },
            { target: TARGET.uploadStart, text: 'tutorial.upStart' },
          ]
        : [
            { target: TARGET.uploadSample, text: 'tutorial.upSample' },
            { target: TARGET.uploadScene, text: 'tutorial.upSampleScene' },
            { target: TARGET.uploadStart, text: 'tutorial.upStart' },
          ];
    case 'analyzing':
      return [
        {
          target: TARGET.analyzingProgress,
          text: mode === 'own' ? 'tutorial.anOwn' : 'tutorial.anSample',
        },
      ];
    case 'coach':
      return [
        { target: TARGET.coachQuestion, text: 'tutorial.coQuestion' },
        { target: TARGET.coachComposer, text: 'tutorial.coAnswer' },
      ];
    case 'report':
      return [{ target: TARGET.reportNote, text: 'tutorial.reNote' }];
    case 'readingNew':
      return mode === 'own'
        ? [
            { target: TARGET.readingDrop, text: 'tutorial.rdDrop' },
            { target: TARGET.readingNext, text: 'tutorial.rdNext' },
          ]
        : [
            { target: TARGET.readingText, text: 'tutorial.rdSampleText' },
            { target: TARGET.readingNext, text: 'tutorial.rdNext' },
          ];
    case 'readingConfirm':
      return [
        { target: TARGET.readingSummary, text: 'tutorial.rdSummary' },
        { target: TARGET.readingSave, text: 'tutorial.rdSave' },
      ];
    case 'readingRoles':
      return [
        { target: TARGET.readingRoleList, text: mode === 'sample' ? 'tutorial.rdSampleRoles' : 'tutorial.rdRoles' },
        { target: TARGET.readingRoleStart, text: 'tutorial.rdRoleStart' },
      ];
    case 'readingRange':
      return [
        { target: TARGET.readingMode, text: 'tutorial.rdMode' },
        { target: TARGET.readingRangeStart, text: 'tutorial.rdGo' },
      ];
  }
}

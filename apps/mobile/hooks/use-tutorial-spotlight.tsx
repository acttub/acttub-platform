import { useEffect, useMemo, useRef, useState } from 'react';

import { SpotlightGuide } from '@/components/spotlight-guide';
import { logEvent } from '@/lib/analytics';
import { markReadingTutorialSeen, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import {
  currentTutorial,
  endTutorial,
  onTutorialChanged,
  stageTrack,
  tutorialSteps,
  type TutorialStage,
} from '@/lib/tutorial';

/**
 * 튜토리얼을 끝낸다 — 끝까지 봤든 중간에 건너뛰었든 (SOMA-494).
 *
 * <p>다시 띄우지 않게 기록하고, 그 갈래 탭의 첫 안내도 본 것으로 친다. 한 바퀴를 돈 사람에게
 * "여기서 시작해요"를 또 비추면 군더더기다.
 */
export function finishTutorial(how: 'done' | 'skip' | 'left'): void {
  const tutorial = currentTutorial();
  if (!tutorial) return;
  logEvent('tutorial_finish', { mode: tutorial.mode, track: tutorial.track, how });
  endTutorial();
  if (tutorial.track === 'reading') {
    void markReadingTutorialSeen();
    void markSpotlightSeen('reading');
  } else {
    void markTutorialSeen();
    void markSpotlightSeen('home');
  }
}

/**
 * 튜토리얼 중이면 이 화면에서 누를 곳을 비춘다. 화면마다 한 번만 — 다 보고 나면 손을 뗀다.
 *
 * <p>{@code ready} 가 false 인 동안은 기다린다. 비출 요소가 아직 안 그려진 화면(질문이 오기
 * 전의 코치 화면 같은)에서 빈 자리를 비추지 않게 하려는 것이다.
 */
export function useTutorialSpotlight(
  stage: TutorialStage,
  options: { ready?: boolean; onDone?: (how: 'skip' | 'done') => void } = {},
) {
  const [tutorial, setTutorial] = useState(currentTutorial);
  const [seen, setSeen] = useState(false);
  const onDone = useRef(options.onDone);
  onDone.current = options.onDone;

  useEffect(() => onTutorialChanged(() => setTutorial(currentTutorial())), []);
  // 다른 갈래를 도는 중이면 이 화면은 비추지 않는다.
  const active = !!tutorial && tutorial.track === stageTrack(stage);

  const steps = useMemo(
    () => (tutorial && active ? tutorialSteps(stage, tutorial.mode) : []),
    [active, tutorial, stage],
  );

  useEffect(() => {
    if (tutorial && active) logEvent('tutorial_step', { mode: tutorial.mode, track: tutorial.track, stage });
  }, [active, tutorial, stage]);

  const visible = active && !seen && (options.ready ?? true);

  const element = (
    <SpotlightGuide
      visible={visible}
      topic={`tutorial.${stage}`}
      steps={steps}
      onDone={(how) => {
        setSeen(true);
        if (how === 'skip') finishTutorial('skip');
        onDone.current?.(how);
      }}
    />
  );

  return { active, mode: active ? (tutorial?.mode ?? null) : null, element };
}

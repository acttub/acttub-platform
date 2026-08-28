/**
 * 리딩 단계와 URL. 단계마다 페이지가 하나씩이고(뒤로 가기·링크 공유가 되게),
 * 앞 단계 데이터가 없으면 앞 페이지로 돌려보낸다 — read.acttub.com 의 규칙 그대로.
 */

export type Step = "input" | "script" | "setup" | "run" | "done";

export const STEP_PATH: Record<Step, string> = {
  input: "/reading",
  script: "/reading/script",
  setup: "/reading/setup",
  run: "/reading/run",
  done: "/reading/done",
};

export interface StepState {
  hasScript: boolean;
  hasSetup: boolean;
  hasStats: boolean;
  /** 데스크톱은 대본 확인을 배역 정하기 화면 안에 같이 보여 주므로 /reading/script 가 없다 */
  desktop: boolean;
}

/**
 * 이 단계에 있어도 되는가. 안 되면 가야 할 경로를 준다.
 * 가장 가까운 앞 단계로 보낸다 — 대본이 없으면 대본 넣기, 설정이 없으면 배역 정하기.
 */
export function redirectFor(step: Step, s: StepState): string | null {
  switch (step) {
    case "input":
      return null;
    case "script":
      if (!s.hasScript) return STEP_PATH.input;
      if (s.desktop) return STEP_PATH.setup;
      return null;
    case "setup":
      return s.hasScript ? null : STEP_PATH.input;
    case "run":
      if (!s.hasScript) return STEP_PATH.input;
      if (!s.hasSetup) return STEP_PATH.setup;
      return null;
    case "done":
      if (!s.hasScript) return STEP_PATH.input;
      if (!s.hasSetup) return STEP_PATH.setup;
      if (!s.hasStats) return STEP_PATH.run;
      return null;
  }
}

/** 대본을 넣은 다음에 갈 곳 — 폰은 확인 화면, 데스크톱은 바로 배역 정하기 */
export function afterInput(desktop: boolean): string {
  return desktop ? STEP_PATH.setup : STEP_PATH.script;
}

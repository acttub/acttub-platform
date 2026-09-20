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

/** 대본 상세. 프리렌더한 껍데기(/reading/scripts)를 rewrite 로 서빙하고 브라우저가 경로에서 id 를 읽는다. */
export function scriptDetailPath(scriptId: string): string {
  return `/reading/scripts/${encodeURIComponent(scriptId)}`;
}

/** 경로에서 대본 id. 껍데기만 연 경우(/reading/scripts)와 한 단계를 넘는 경로는 없다. */
export function scriptIdFromPath(pathname: string): string | null {
  const match = /^\/reading\/scripts\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return null;
  }
}

export interface StepState {
  /** 대본 넣기에서 확인 화면으로 넘긴 초안이 있는가(폰) */
  hasDraft: boolean;
  /** 서버에 저장된 대본을 들고 있는가 */
  hasScript: boolean;
  /** 시작하거나 이어 하는 회차를 들고 있는가 */
  hasSession: boolean;
  hasStats: boolean;
  /** 데스크톱은 대본 확인을 대본 넣기 화면 안에 같이 보여 주므로 /reading/script 가 없다 */
  desktop: boolean;
}

/**
 * 이 단계에 있어도 되는가. 안 되면 가야 할 경로를 준다.
 * 가장 가까운 앞 단계로 보낸다 — 대본이 없으면 대본 넣기, 회차가 없으면 배역 정하기.
 */
export function redirectFor(step: Step, s: StepState): string | null {
  switch (step) {
    case "input":
      return null;
    case "script":
      // 확인 화면은 저장 전 초안을 본다. 데스크톱은 그 초안을 대본 넣기 화면 안에서 본다.
      if (s.desktop || !s.hasDraft) return STEP_PATH.input;
      return null;
    case "setup":
      return s.hasScript ? null : STEP_PATH.input;
    case "run":
      if (!s.hasScript) return STEP_PATH.input;
      if (!s.hasSession) return STEP_PATH.setup;
      return null;
    case "done":
      if (!s.hasScript) return STEP_PATH.input;
      if (!s.hasSession) return STEP_PATH.setup;
      if (!s.hasStats) return STEP_PATH.run;
      return null;
  }
}

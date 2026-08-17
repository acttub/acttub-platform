import { useCallback, useEffect, useState } from "react";

import type { PracticeSessionStatus } from "@/lib/api/v2/types";

import {
  advanceProgress,
  analysisProgress,
  analysisStart,
  compressionProgress,
  isAnalysisPastDeadline,
  settleProgress,
  uploadProgress,
} from "./analysis-progress";

// 구간 경계와 곡선은 analysis-progress.ts 가 정한다. 이 파일이 맡는 것은 그 계산을
// 언제 어떤 값으로 부르는지 — 진행률 상태의 생애다.
//
// 화면은 이 훅에 벌어진 일만 알려 준다(report). 언제 막대가 얼마나 차는지, 1초 타이머를
// 언제 걸고 언제 걷는지는 전부 여기 안에서 끝난다. 그래서 리셋이 한 곳이고,
// "pct 만 되돌리고 경과 시간은 두고 가는" 부분 리셋이 아예 표현되지 않는다.
export type AnalysisProgressEvent =
  /** 준비 화면으로 되돌아갔다. 영상을 다시 고르거나 업로드를 새로 시작할 때. */
  | { type: "reset" }
  /** 압축이 ratio(0~1)만큼 진행됐다. */
  | { type: "compress"; ratio: number }
  /** 업로드가 percent 만큼 올라갔다. compressed 는 압축을 실제로 돌렸는지. */
  | { type: "upload"; percent: number; compressed: boolean }
  /**
   * 영상 길이를 알게 됐다. 분석 구간의 채움 기간이 여기에 비례한다.
   * 두 곳에서 온다 — 업로드 준비가 잰 길이, 그리고 화면의 <video> 가 메타데이터를
   * 읽고 알려 주는 길이. 목록에서 연 세션은 뒤엣것으로만 알 수 있어서 분석이
   * 시작된 뒤에 늦게 도착한다.
   */
  | { type: "duration"; videoDurationMs: number | null }
  /**
   * 서버가 장면을 훑기 시작했다. 목록·주소로 연 세션은 압축을 탔는지 모르므로
   * `{ compressed: false }` 로 들어온다.
   */
  | { type: "analyze"; compressed: boolean }
  /** 분석이 끝났다(analyzed 면 100, 그 밖은 있던 자리에 멈춘다). */
  | { type: "settle"; status: PracticeSessionStatus };

// 타이머는 훅이 감춘다 — 밖에서 부를 일이 없어 이벤트 유니온에 넣지 않는다.
type AnalysisProgressAction = AnalysisProgressEvent | { type: "tick" };

export type AnalysisProgressState = {
  pct: number;
  /** 분석 구간이 출발하는 자리. 압축을 탔으면 90, 아니면 60. */
  startPct: number;
  /** 분석 구간에 들어간 시각. 경과 시간은 전부 여기서 잰다. */
  startedAt: number | null;
  elapsedMs: number;
  videoDurationMs: number | null;
  /** 1초 타이머가 돌아야 하는가. analyze 에서 서고 settle·reset 에서 눕는다. */
  waiting: boolean;
};

export const INITIAL_ANALYSIS_PROGRESS: AnalysisProgressState = {
  pct: 0,
  startPct: analysisStart(false),
  startedAt: null,
  elapsedMs: 0,
  videoDurationMs: null,
  waiting: false,
};

// 분석 중에는 서버가 아무 말도 하지 않는 구간이 길다. 1초마다 스스로 움직여야
// 멈춘 것으로 읽히지 않는다.
export const ANALYSIS_TICK_MS = 1000;

export function analysisProgressReducer(
  state: AnalysisProgressState,
  action: AnalysisProgressAction,
  now: number,
): AnalysisProgressState {
  switch (action.type) {
    case "reset":
      return INITIAL_ANALYSIS_PROGRESS;

    case "compress":
      return {
        ...state,
        pct: advanceProgress(state.pct, compressionProgress(action.ratio)),
      };

    case "upload":
      return {
        ...state,
        pct: advanceProgress(
          state.pct,
          uploadProgress(action.percent, action.compressed),
        ),
      };

    case "duration":
      return { ...state, videoDurationMs: action.videoDurationMs };

    case "analyze": {
      const startPct = analysisStart(action.compressed);
      return {
        ...state,
        pct: advanceProgress(state.pct, startPct),
        startPct,
        startedAt: now,
        elapsedMs: 0,
        waiting: true,
      };
    }

    case "settle":
      return {
        ...state,
        pct: settleProgress(state.pct, action.status),
        waiting: false,
      };

    case "tick": {
      // 이미 끝났는데 늦게 도착한 틱은 막대를 더 밀지 않는다. 같은 객체를 돌려주어
      // 쓸데없는 렌더도 만들지 않는다.
      if (!state.waiting || state.startedAt === null) return state;
      const elapsedMs = now - state.startedAt;
      return {
        ...state,
        elapsedMs,
        pct: advanceProgress(
          state.pct,
          analysisProgress(elapsedMs, state.videoDurationMs, state.startPct),
        ),
      };
    }
  }
}

export type AnalysisProgress = {
  pct: number;
  elapsedMs: number;
  pastDeadline: boolean;
  videoDurationMs: number | null;
  report: (event: AnalysisProgressEvent) => void;
};

export function useAnalysisProgress(): AnalysisProgress {
  const [state, setState] = useState(INITIAL_ANALYSIS_PROGRESS);

  const report = useCallback((event: AnalysisProgressEvent) => {
    setState((current) => analysisProgressReducer(current, event, Date.now()));
  }, []);

  // 타이머가 걸리고 걷히는 조건은 waiting 하나뿐이다. 여기에 pct 나 경과 시간이
  // 딸려 들어오면 틱마다 타이머를 다시 걸어 1초 주기가 흔들린다.
  useEffect(() => {
    if (!state.waiting) return;
    const timer = window.setInterval(() => {
      setState((current) =>
        analysisProgressReducer(current, { type: "tick" }, Date.now()),
      );
    }, ANALYSIS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [state.waiting]);

  return {
    pct: state.pct,
    elapsedMs: state.elapsedMs,
    pastDeadline: isAnalysisPastDeadline(state.elapsedMs),
    videoDurationMs: state.videoDurationMs,
    report,
  };
}

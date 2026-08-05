import type { CoachTurn, PracticeReport, SceneContext, VideoFile } from '@/lib/api';

/**
 * 진행 중인 연습의 화면 간 공유 상태 (모듈 스토어).
 *
 * v2에서 서버가 세션·요약·대화를 영속화하므로 클라이언트는 화면 표시에 필요한 만큼만 들고 간다.
 * - practiceSessionId: 업로드·분석 세션(영상). 재분석에 쓴다.
 * - practiceSessionId: 영상 처리와 코치 시작에 함께 쓴다.
 * - coachSessionId: 코치 대화 세션 id → 코치 답장·리포트 생성에 쓴다.
 * - turns: 화면 표시용 대화 누적(정본은 서버).
 *
 * v1의 "threadId를 user_id로 넘겨 같은 장면끼리 비교"하던 트릭은 v2에 없어 제거했다.
 */
export type Practice = {
  practiceSessionId: string;
  coachSessionId: string | null;
  scene: SceneContext;
  /** 코치/대기 화면 재생용 — 서버 업로드본이 아닌 사용자가 올린 원본 로컬 uri. */
  videoUri: string;
  playbackUrl: string | null;
  turns: CoachTurn[];
  questionCount: number;
  report: PracticeReport | null;
};

/** 업로드 화면에서 받아 분석 대기 화면이 소비하는 업로드 대기물. */
export type PendingUpload = {
  scene: SceneContext;
  video: VideoFile;
  durationMs: number | null;
};

let current: Practice | null = null;
let pending: PendingUpload | null = null;
/** 기록에서 "같은 장면 다시 찍기"로 넘어올 때 업로드 폼에 채울 의도(비교 로직 없이 프리필만). */
let prefill: SceneContext | null = null;

export function setPrefill(scene: SceneContext) {
  prefill = scene;
}

export function takePrefill(): SceneContext | null {
  const p = prefill;
  prefill = null;
  return p;
}

export function setPendingUpload(upload: PendingUpload) {
  pending = upload;
}

export function takePendingUpload(): PendingUpload | null {
  const p = pending;
  pending = null;
  return p;
}

export function startPractice(input: {
  practiceSessionId: string;
  scene: SceneContext;
  videoUri: string;
  playbackUrl: string | null;
}): Practice {
  current = {
    practiceSessionId: input.practiceSessionId,
    coachSessionId: null,
    scene: input.scene,
    videoUri: input.videoUri,
    playbackUrl: input.playbackUrl,
    turns: [],
    questionCount: 0,
    report: null,
  };
  return current;
}

export function getPractice(): Practice | null {
  return current;
}

export function clearPractice() {
  current = null;
}

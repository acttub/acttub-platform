import type { SceneContext } from '@/lib/api';
import type { ContinueOrigin } from './resume.ts';
import type { PracticeNote } from './types.ts';

/**
 * 화면 사이로 들고 다니는 진행 중 회차(모듈 스토어). 정본은 서버이고 여기는 표시에 필요한 만큼만 둔다.
 *
 * - practiceId·rootId·ordinal: 묶음의 몇 번째 회차인지. 대화 시작·노트가 쓴다.
 * - videoUri·playbackUrl: 기다리는 동안과 대화 중에 영상을 다시 트는 데 쓴다.
 * - conversationId·note: 대화 화면이 채우고 노트 화면이 읽는다(정본은 서버).
 * - 이어하기 출처(continue origin)와 고른 영상은 준비 화면이 꺼내 간다.
 */
export type Practice = {
  practiceId: string;
  rootId: string;
  ordinal: number;
  /** 회차와 1:1 인 대화. 아직 시작하지 않았으면 null. */
  conversationId: string | null;
  scene: SceneContext;
  /** 기기 복사본 uri 또는 빈 문자열. 없으면 playbackUrl 로 튼다. */
  videoUri: string;
  playbackUrl: string | null;
  /** 대화가 닫히며 함께 온 노트. 없으면 노트 화면이 서버에서 읽는다. */
  note: PracticeNote | null;
};

let current: Practice | null = null;
let origin: ContinueOrigin | null = null;

/** 이어하기로 들어갈 때 준비 화면에 넘기는 것(A13 노트·A1.2 기록·A8.1 이전 연습). */
export function setContinueOrigin(next: ContinueOrigin | null): void {
  origin = next;
}

/** 꺼내면 비워진다 — 다음 새 연습에 이어받기가 새면 안 된다. */
export function takeContinueOrigin(): ContinueOrigin | null {
  const o = origin;
  origin = null;
  return o;
}

export function startPractice(input: {
  practiceId: string;
  rootId: string;
  ordinal: number;
  scene: SceneContext;
  videoUri: string;
  playbackUrl: string | null;
}): Practice {
  current = {
    practiceId: input.practiceId,
    rootId: input.rootId,
    ordinal: input.ordinal,
    conversationId: null,
    scene: input.scene,
    videoUri: input.videoUri,
    playbackUrl: input.playbackUrl,
    note: null,
  };
  return current;
}

export function getPractice(): Practice | null {
  return current;
}

export function clearPractice(): void {
  current = null;
}

/**
 * 진행 중인 것과 넘기려던 것을 한꺼번에 버린다. 탈퇴·계정 교체 때 쓴다.
 * 모듈 변수라 로그아웃해도 남는다 — 두고 가면 다음 사람 화면에 앞사람이 적은 장면이 뜬다.
 */
export function resetPracticeState(): void {
  current = null;
  origin = null;
}

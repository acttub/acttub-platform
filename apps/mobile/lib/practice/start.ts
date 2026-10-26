import { errorCode, errorStatus, isOfflineError } from '../api-request.ts';
import { sceneValueForSubmit } from '../upload-input.ts';
import type {
  BlockageCategory,
  BlockageDetail,
  ContinuePracticeBody,
  CreatePracticeBody,
  PracticeBlockage,
  PracticeGroup,
  PracticeScene,
} from './types.ts';

/**
 * 새 연습 시작·이어하기의 요청 만들기와 오류 판정(practice.start · practice.resume).
 *
 * 화면은 여기서 만든 본문을 그대로 보낸다. 한 번의 시도는 같은 요청 id를 쓰고(같은 본문 재전송은
 * 회차 하나), 본문을 고치면 화면이 새 id를 만든다(같은 id·다른 본문은 422 request_fingerprint_mismatch).
 * 장면 세 칸과 막힘은 모두 선택이고, 고르지 않으면 '그 외/그 외'(막힘 미특정)로 간다.
 */
export const SCENE_MAX = 300;
export const BLOCKAGE_NOTE_MAX = 500;

export type SceneDraft = {
  situation: string;
  character: string;
  goal: string;
};

export type BlockageDraft = {
  category: BlockageCategory | null;
  detail: BlockageDetail | null;
  note: string;
};

export const emptySceneDraft: SceneDraft = { situation: '', character: '', goal: '' };
export const emptyBlockageDraft: BlockageDraft = { category: null, detail: null, note: '' };

/** 서버가 422로 막기 전에 화면이 먼저 막는다. 넘친 칸 이름을 돌려준다. */
export function sceneOverflow(scene: SceneDraft): keyof SceneDraft | null {
  if (scene.situation.trim().length > SCENE_MAX) return 'situation';
  if (scene.character.trim().length > SCENE_MAX) return 'character';
  if (scene.goal.trim().length > SCENE_MAX) return 'goal';
  return null;
}

export function blockageNoteOverflow(blockage: BlockageDraft): boolean {
  return blockage.note.trim().length > BLOCKAGE_NOTE_MAX;
}

/** 비운 칸은 빈 문자열로 간다 — 자리표시자를 만들지 않는다(ADR-021 개정). */
function normalizeScene(scene: SceneDraft): PracticeScene {
  return {
    situation: sceneValueForSubmit(scene.situation),
    character: sceneValueForSubmit(scene.character),
    goal: sceneValueForSubmit(scene.goal),
  };
}

function normalizeBlockage(blockage: BlockageDraft): PracticeBlockage {
  return {
    category: blockage.category ?? '그 외',
    detail: blockage.detail ?? '그 외',
    note: blockage.note.trim() || null,
  };
}

/** 묶음 제목 상한 — 서버의 묶음 제목 PATCH 와 같다(SOMA-671). */
export const PRACTICE_TITLE_MAX = 200;

export function titleOverflow(title: string): boolean {
  return title.trim().length > PRACTICE_TITLE_MAX;
}

export function buildStartBody(input: {
  requestId: string;
  videoId: string;
  scene: SceneDraft;
  blockage: BlockageDraft;
  title?: string;
}): CreatePracticeBody {
  const body: CreatePracticeBody = {
    request_id: input.requestId,
    video_id: input.videoId,
    scene: normalizeScene(input.scene),
    blockage: normalizeBlockage(input.blockage),
  };
  // 비운 제목은 싣지 않는다 — 제목 칸을 모르는 옛 서버에도 그대로 간다.
  const title = input.title?.trim();
  if (title) body.title = title;
  return body;
}

/**
 * 이어하기(다음 테이크) 본문. 앱은 늘 새로 고른 video_id를 싣는다(SOMA-672). 서버는 video_id를 빼면
 * 이전 회차의 영상을 쓰지만, 앱은 그 길을 쓰지 않는다 — 옛 영상도 보관함에서 골라 id로 싣는다.
 */
export function buildContinueBody(input: {
  requestId: string;
  videoId: string;
  scene: SceneDraft;
  blockage: BlockageDraft;
}): ContinuePracticeBody {
  return {
    request_id: input.requestId,
    video_id: input.videoId,
    scene: normalizeScene(input.scene),
    blockage: normalizeBlockage(input.blockage),
  };
}

export type StartFailure =
  /** 묶음에 닫히지 않은 회차가 있다. 묶음 조회로 그 회차 id를 얻어 복귀시킨다. */
  | { kind: 'in_progress' }
  /** 영상이 아직 확정되지 않았다(올리는 중). 확정되면 같은 요청 id로 다시 보낸다. */
  | { kind: 'video_not_ready' }
  /** 게스트 하루 3회를 다 썼다. 회차도 작업도 생기지 않았다. */
  | { kind: 'daily_limit' }
  /** 무료 코칭 하루 3회를 다 썼다(SOMA-818, 서버 무료 한도 플래그가 켜졌을 때만). Pro 시트를 띄운다. */
  | { kind: 'free_limit' }
  /** 같은 요청 id로 다른 본문을 보냈다. 새 요청 id로 다시 만든다. */
  | { kind: 'fingerprint_mismatch' }
  /** 연결이 끊겼다. 같은 요청 id로 다시 보내면 회차는 하나다. */
  | { kind: 'offline' }
  | { kind: 'other'; status: number | null; code: string | null };

/** 시작·이어하기가 실패한 까닭. 409의 본문은 코드뿐이라 회차 id는 묶음 조회에서 얻는다. */
export function startFailure(error: unknown): StartFailure {
  const code = errorCode(error);
  const status = errorStatus(error);
  if (code === 'practice_in_progress' || status === 409) return { kind: 'in_progress' };
  if (code === 'video_not_ready') return { kind: 'video_not_ready' };
  if (code === 'free_daily_coaching_limit') return { kind: 'free_limit' };
  if (code === 'guest_daily_analysis_limit' || status === 429) return { kind: 'daily_limit' };
  if (code === 'request_fingerprint_mismatch') return { kind: 'fingerprint_mismatch' };
  if (isOfflineError(error)) return { kind: 'offline' };
  return { kind: 'other', status, code };
}

/**
 * 묶음 목록에서 진행 중 회차 id를 찾는다. rootId를 주면 그 묶음만, 없으면 어느 묶음이든 첫 번째다
 * (닫히지 않은 회차는 계정 전체에서 하나뿐이다).
 */
export function inProgressPracticeId(
  groups: readonly PracticeGroup[],
  rootId?: string | null,
): string | null {
  const scoped = rootId ? groups.filter((g) => g.root_id === rootId) : groups;
  for (const group of scoped) {
    if (group.in_progress_practice_id) return group.in_progress_practice_id;
  }
  return null;
}

export function fingerprintOf(body: CreatePracticeBody | ContinuePracticeBody): string {
  const parts: (string | null)[] = [
    'video_id' in body ? body.video_id ?? null : null,
    body.scene.situation,
    body.scene.character,
    body.scene.goal,
    body.blockage.category,
    body.blockage.detail,
    body.blockage.note,
  ];
  // 제목은 실었을 때만 붙인다 — 제목 없는 요청의 지문은 예전 그대로다(SOMA-671).
  if ('title' in body && body.title) parts.push(body.title);
  return JSON.stringify(parts);
}

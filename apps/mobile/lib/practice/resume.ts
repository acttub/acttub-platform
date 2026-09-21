import { emptySceneDraft, type SceneDraft } from './start.ts';

/**
 * 이어하기의 준비 화면 규칙(practice.resume).
 *
 * 회차마다 상황·인물·목표·막힘을 새로 확정한다. 앱에서 방금 끝낸 노트(A13)에서 이어갈 때만
 * 이전 장면을 미리 채워 두고, 지난 기록(A1.2)이나 새 연습 화면(A8.1)에서 이어갈 때는 빈
 * 준비 화면이다. A1.2는 그 회차의 영상을 그대로 쓰고, A13·A8.1은 영상을 새로 고른다.
 */
export type ContinueOrigin =
  /** A13 연습 마치기 → 다음 연습. 장면을 미리 채우고 영상은 새로 고른다. */
  | { kind: 'note'; rootId: string; practiceId: string; scene: SceneDraft }
  /** A1.2 연습 기록 상세의 "이어서 연습하기". 같은 영상으로 다음 회차를 만든다. */
  | { kind: 'history'; rootId: string; practiceId: string; videoId: string }
  /** A8.1 새 연습 화면의 "이전 연습 이어서 하기". 새로 확정한 영상을 쓴다. */
  | { kind: 'group'; rootId: string; practiceId: string };

export type StartPlan = {
  /** 이어하기면 그 묶음, 새 연습이면 null. */
  continueFrom: { rootId: string; practiceId: string } | null;
  scene: SceneDraft;
  /** 장면을 미리 채웠는지 — 화면 제목·버튼 문구가 이걸 본다. */
  prefilled: boolean;
  video: { kind: 'same'; videoId: string } | { kind: 'pick' };
};

export function planFor(origin: ContinueOrigin | null): StartPlan {
  if (!origin) {
    return { continueFrom: null, scene: emptySceneDraft, prefilled: false, video: { kind: 'pick' } };
  }
  const continueFrom = { rootId: origin.rootId, practiceId: origin.practiceId };
  if (origin.kind === 'note') {
    return { continueFrom, scene: origin.scene, prefilled: true, video: { kind: 'pick' } };
  }
  if (origin.kind === 'history') {
    return {
      continueFrom,
      scene: emptySceneDraft,
      prefilled: false,
      video: { kind: 'same', videoId: origin.videoId },
    };
  }
  return { continueFrom, scene: emptySceneDraft, prefilled: false, video: { kind: 'pick' } };
}

/**
 * 이어하기 본문에 실을 video_id. 같은 영상으로 이어가면 싣지 않아 서버가 이전 회차의 영상을
 * 쓰고, 새 영상이면 확정된 id를 싣는다. 아직 영상을 못 골랐으면 시작할 수 없다.
 */
export function continueVideoId(plan: StartPlan, pickedVideoId: string | null): string | null {
  return plan.video.kind === 'same' ? null : pickedVideoId;
}

/** 시작 버튼을 누를 수 있는 상태인지 — 새 영상을 고르는 흐름은 확정된 영상이 있어야 한다. */
export function canStart(plan: StartPlan, pickedVideoId: string | null): boolean {
  return plan.video.kind === 'same' || Boolean(pickedVideoId);
}

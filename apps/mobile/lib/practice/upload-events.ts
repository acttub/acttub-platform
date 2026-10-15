/**
 * 새 연습 준비 화면(upload)에서 배우가 어디서 멈추는지 세는 이벤트(SOMA-698).
 *
 * 2026-10-06~12 영상 업로드는 끝났지만 질문 받기까지 안 간 업로드가 91건이었다. 질문 받기 버튼은
 * 영상 확정(업로드 완료)과 권리 확인 체크가 모두 돼야 눌린다. 어느 쪽에서 멈췄는지 이벤트가 없어 알 수 없었다.
 *
 * 순서:
 * 1. practice_video_picked  — 영상을 고름(경로·길이 구간·업로드가 필요한지)
 * 2. practice_video_ready   — 올리던 영상이 확정됨(기다린 초)
 * 3. practice_rights_toggle — 권리 확인을 켜거나 끔
 * 4. practice_start_blocked — 회색(준비 안 된) 질문 받기를 누름(막힌 이유)
 * 5. practice_start(기존)   — 연습 시작
 * 6. practice_upload_exit   — 시작하지 않고 화면을 떠남(멈춘 단계·머문 초·회색 버튼 누른 횟수)
 *
 * 이름·값은 GA4 규칙(snake_case, 40자 이내)이다. 영상·연습 id, 파일 경로, 글 내용은 넣지 않는다.
 * 앱이 강제 종료되면 화면이 정리되지 않아 6번이 안 남는다 — 남은 것만으로 비율을 단정하지 않는다.
 */

export const PRACTICE_UPLOAD_EVENTS = {
  videoPicked: 'practice_video_picked',
  videoReady: 'practice_video_ready',
  rightsToggle: 'practice_rights_toggle',
  startBlocked: 'practice_start_blocked',
  screenExit: 'practice_upload_exit',
} as const;

type EventParams = Record<string, string | number>;

/** gallery = 갤러리에서 고름, record = 앱에서 방금 찍음, library = 보관함에서 고름. */
export type PickSource = 'gallery' | 'record' | 'library';

/** 질문 받기가 막힌 이유. 화면 아래 안내 문구와 같은 순서로 판정한다. */
export type StartBlockReason = 'no_video' | 'uploading' | 'rights';

export type StartState = { hasVideo: boolean; uploading: boolean; rights: boolean };

export function startBlockReason(state: StartState): StartBlockReason | null {
  if (!state.hasVideo) return 'no_video';
  if (state.uploading) return 'uploading';
  if (!state.rights) return 'rights';
  return null;
}

export type LengthBucket = 'unknown' | 'lt3s' | '3_10s' | '10_30s' | '30_60s' | '1_3m' | 'gt3m';

/** 길이는 구간으로만 보낸다. 3초 미만은 잘못 누른 촬영일 가능성이 커서 따로 본다. */
export function lengthBucket(durationMs: number | null | undefined): LengthBucket {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return 'unknown';
  if (durationMs < 3_000) return 'lt3s';
  if (durationMs < 10_000) return '3_10s';
  if (durationMs < 30_000) return '10_30s';
  if (durationMs < 60_000) return '30_60s';
  if (durationMs < 180_000) return '1_3m';
  return 'gt3m';
}

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

export function videoPickedParams(source: PickSource, needsUpload: boolean, durationMs: number | null | undefined): EventParams {
  return { source, needs_upload: needsUpload ? 'yes' : 'no', length: lengthBucket(durationMs) };
}

export function videoReadyParams(source: PickSource, waitMs: number): EventParams {
  return { source, wait_s: seconds(waitMs) };
}

export function rightsToggleParams(checked: boolean): EventParams {
  return { checked: checked ? 'on' : 'off' };
}

export function startBlockedParams(reason: StartBlockReason): EventParams {
  return { reason };
}

export type ExitState = StartState & {
  source: PickSource | null;
  blockedTaps: number;
  openedAt: number;
  now: number;
};

/** stage=ready 는 모든 조건이 갖춰졌는데 질문 받기를 누르지 않고 나간 경우다. */
export function uploadExitParams(state: ExitState): EventParams {
  return {
    stage: startBlockReason(state) ?? 'ready',
    source: state.source ?? 'none',
    rights: state.rights ? 'on' : 'off',
    blocked_taps: Math.max(0, Math.floor(state.blockedTaps)),
    stay_s: seconds(state.now - state.openedAt),
  };
}

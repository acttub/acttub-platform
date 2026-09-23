/**
 * 새 연습 준비 화면이 받을 영상 하나(A8). 보관함에서 고르거나, 새로 찍거나, 갤러리에서 고른다.
 *
 * 촬영·갤러리는 보관함 큐에 먼저 들어가므로(practice.record) 아직 확정 전일 수 있다. 그때는
 * pendingId 만 있고 videoId 는 확정된 뒤에 채워진다 — 준비 화면이 확정을 기다렸다 시작한다.
 * 화면 사이를 uri 같은 큰 값으로 나르지 않으려고 모듈 변수로 한 번 얹고 준비 화면이 꺼내 간다.
 */
export type PickedVideo = {
  /** 확정된 보관함 영상. 아직 올리는 중이면 null. */
  videoId: string | null;
  /** 올리는 중인 대기 항목. 확정되면 videoId 가 생긴다. */
  pendingId: string | null;
  /** 기기 복사본 — 미리보기·재생에 쓴다. 없으면 서명 주소로 튼다. */
  uri: string | null;
  playbackUrl: string | null;
  durationMs: number | null;
};

let picked: PickedVideo | null = null;

export function setPickedVideo(video: PickedVideo): void {
  picked = video;
}

/** 비우지 않고 들여다본다 — 준비 화면이 다시 그릴 때. */
export function peekPickedVideo(): PickedVideo | null {
  return picked;
}

/** 꺼내며 비운다. */
export function takePickedVideo(): PickedVideo | null {
  const v = picked;
  picked = null;
  return v;
}

export function clearPickedVideo(): void {
  picked = null;
}

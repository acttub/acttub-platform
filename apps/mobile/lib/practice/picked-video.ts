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
  /** 어디서 왔는지(계측용, SOMA-698). 앱에서 방금 찍은 영상만 'record' 로 표시하고, 없으면 보관함에서 고른 것이다. */
  source?: 'record';
};

let picked: PickedVideo | null = null;

export function setPickedVideo(video: PickedVideo): void {
  picked = video;
}

/** 비우지 않고 들여다본다 — 준비 화면이 다시 그릴 때. */
export function peekPickedVideo(): PickedVideo | null {
  return picked;
}

/**
 * 준비 화면이 처음 그릴 영상. 다음 테이크(이어하기)는 늘 빈 영상 상자에서 시작한다 — 전에 얹혀 남은 영상이
 * 있어도 버려서, 이 흐름에서 방금 고른 영상이 아니면 들어오지 않는다(SOMA-672). 새 연습은 보관함 상세·촬영이
 * 넘긴 영상을 그대로 받는다(꺼내는 건 화면이 포커스될 때 takePickedVideo 가 한다).
 */
export function initialPickedVideo(continuing: boolean): PickedVideo | null {
  if (continuing) {
    picked = null;
    return null;
  }
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

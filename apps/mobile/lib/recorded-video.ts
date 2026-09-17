/**
 * 앱 내 촬영 결과 핸드오프 (SOMA-477).
 *
 * 촬영 화면이 찍은 영상을 업로드 화면으로 넘길 때 쓴다. prefill 과 같은 방식 —
 * 화면 사이를 라우터 파라미터로 큰 값(uri)을 나르면 지저분해서, 모듈 변수로
 * 한 번 얹고 업로드가 꺼내 간다. 꺼내면 비워져서 두 번 소비되지 않는다.
 */

export type RecordedVideo = {
  uri: string;
  /** 촬영이 잰 길이(ms). 못 쟀으면 null. */
  durationMs: number | null;
  name: string;
};

let pending: RecordedVideo | null = null;

export function setRecordedVideo(video: RecordedVideo): void {
  pending = video;
}

/** 대기 중인 촬영 결과를 꺼내며 비운다. 없으면 null. */
export function takeRecordedVideo(): RecordedVideo | null {
  const v = pending;
  pending = null;
  return v;
}

/**
 * 비우지 않고 들여다본다 — 촬영 뒤 "챌린지에 올릴지 / AI 분석할지" 고르는 화면이 미리보기만
 * 그릴 때. take 로 꺼내면 다음 화면(업로드·챌린지 올리기)이 결과를 못 받는다.
 */
export function peekRecordedVideo(): RecordedVideo | null {
  return pending;
}

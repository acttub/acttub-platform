export const MAX_VIDEO_DURATION_MS = 300_000;

export type UploadIntentInput = {
  mime_type: string;
  size_bytes: number;
  duration_ms?: number | null;
};

export function normalizeVideoDurationMs(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field}는 양의 정수여야 합니다.`);
  }
}

export function prepareUploadIntentBody(input: UploadIntentInput): string {
  requirePositiveInteger(input.size_bytes, 'size_bytes');
  if (input.duration_ms !== undefined && input.duration_ms !== null) {
    requirePositiveInteger(input.duration_ms, 'duration_ms');
  }
  return JSON.stringify(input);
}

/** 마지막 글자의 받침 유무로 목적격 조사(을/를)를 고른다. */
export function objectParticle(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '을';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

export type UploadFormState = {
  situation: string;
  character: string;
  goal: string;
  hasVideo: boolean;
  agreedRights: boolean;
};

/**
 * 하단에 고정된 '질문 받기'가 비활성일 때 뭐가 비었는지 알려주는 문구.
 * 버튼이 항상 보이게 되면서 "왜 안 눌리지"가 생기므로 이유를 한 줄로 붙인다.
 * 장면 세 칸은 선택이라(SOMA-432) 영상·권리 확인만 본다.
 */
export function missingUploadFieldsHint(state: UploadFormState): string | null {
  if (!state.hasVideo) return '영상을 채워주세요';
  if (!state.agreedRights) return '권리 확인에 체크해주세요';
  return null;
}

/**
 * 서버는 장면 세 칸에 min_length=1을 요구한다. 빈 칸은 자리표시자로 채워 넘긴다 —
 * 웹(fillBlankScene)과 같은 규칙이고, 코치는 두 글자 미만을 모호값으로 걸러
 * 대화에서 되묻는다.
 */
export const BLANK_SCENE_PLACEHOLDER = '.';

export function sceneValueForSubmit(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : BLANK_SCENE_PLACEHOLDER;
}

/** 서버에서 돌아온 장면 값 표시용 — 자리표시자(두 글자 미만)는 빈 값으로 되돌린다. */
export function sceneValueForDisplay(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed : '';
}

export async function sendUploadIntent<T>(
  input: UploadIntentInput,
  send: (serializedBody: string) => Promise<T>,
): Promise<T> {
  return send(prepareUploadIntentBody(input));
}

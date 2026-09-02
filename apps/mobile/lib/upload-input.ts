import { translate } from './i18n.ts';

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
  if (!state.hasVideo) return translate('upload.missingVideo');
  if (!state.agreedRights) return translate('upload.missingRights');
  return null;
}

/**
 * 장면 칸은 다듬은 값 그대로 보낸다 — 비면 빈 문자열이다(ADR-021, 웹과 같은 값). 자리표시자는
 * 만들지 않는다. 예전 빌드가 보내던 '.'은 서버가 빈 값으로 저장한다.
 */
export function sceneValueForSubmit(value: string): string {
  return value.trim();
}

/**
 * 서버에서 돌아온 장면 값 표시용. 예전 빌드는 빈 칸을 자리표시자('.')로 채워 보냈고 그
 * 세션들이 그대로 남아 있어, 홀로 있는 점은 빈 값으로 되돌린다. 서버가 저장할 때 걷어내는
 * 폭과 같다 — 한 글자 장면("밤")은 그대로 보여준다.
 */
export function sceneValueForDisplay(value: string): string {
  const trimmed = value.trim();
  return trimmed === '.' ? '' : trimmed;
}

export async function sendUploadIntent<T>(
  input: UploadIntentInput,
  send: (serializedBody: string) => Promise<T>,
): Promise<T> {
  return send(prepareUploadIntentBody(input));
}

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
  subtext: string;
  hasVideo: boolean;
  agreedRights: boolean;
};

/**
 * 하단에 고정된 '분석 시작'이 비활성일 때 뭐가 비었는지 알려주는 문구.
 * 버튼이 항상 보이게 되면서 "왜 안 눌리지"가 생기므로 이유를 한 줄로 붙인다.
 */
export function missingUploadFieldsHint(state: UploadFormState): string | null {
  const missing: string[] = [];
  if (!state.hasVideo) missing.push('영상');
  if (!state.situation.trim()) missing.push('상황');
  if (!state.character.trim()) missing.push('인물');
  if (!state.subtext.trim()) missing.push('의도');
  if (missing.length > 0) {
    const list = missing.join(' · ');
    return `${list}${objectParticle(missing[missing.length - 1])} 채워주세요`;
  }
  if (!state.agreedRights) return '권리 확인에 체크해주세요';
  return null;
}

export async function sendUploadIntent<T>(
  input: UploadIntentInput,
  send: (serializedBody: string) => Promise<T>,
): Promise<T> {
  return send(prepareUploadIntentBody(input));
}

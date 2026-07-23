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

export async function sendUploadIntent<T>(
  input: UploadIntentInput,
  send: (serializedBody: string) => Promise<T>,
): Promise<T> {
  return send(prepareUploadIntentBody(input));
}

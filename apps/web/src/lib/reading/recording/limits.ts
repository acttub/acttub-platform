/**
 * 녹음의 기기 쪽 한도와 형식(reading.recording). 파일 10,000,000바이트(원본), 길이 180초. 180초에 이르면 녹음을
 * 멈추고 현재 줄은 그대로다. 넘는 파일은 보내지 않고 안내한다. 형식은 브라우저가 내는 것을 그대로 쓰고
 * content_type 을 정확히 보낸다 — 서버가 m4a(AAC)로 바꿔 저장한다.
 */

export const RECORDING_MAX_BYTES = 10_000_000;
export const RECORDING_MAX_MS = 180_000;
export const RECORDING_TOO_LARGE_COPY = "이 줄 녹음은 너무 길어 저장하지 않았어요.";

export function clipTooLarge(bytes: number): boolean {
  return bytes > RECORDING_MAX_BYTES;
}

/** 브라우저마다 다른 MediaRecorder 형식. webm/opus(크롬·파이어폭스)를 먼저, 없으면 mp4(사파리). */
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickRecordingMimeType(isSupported: (type: string) => boolean): string | null {
  return PREFERRED_MIME_TYPES.find((t) => isSupported(t)) ?? null;
}

export function extensionFor(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/aac" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  return "webm";
}

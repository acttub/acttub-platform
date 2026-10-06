/**
 * 줄 단위 녹음(reading.recording)의 기기 규칙 — 형식, 한도, 시도 번호, 전사·대조 필드. 네이티브를 모른다.
 *
 * 형식은 실제대로 보낸다. STT 가 켜진 회차에서는 인식기가 저장한 파일(wav)을, 아니면 expo-audio 녹음기 파일
 * (m4a)을 쓴다(조정자 결정). m4a 가 아니면 서버가 m4a 로 바꿔 저장한다.
 */
import type { LineMatch } from './match.ts';

/** 파일 한도(올린 원본 기준). 넘으면 보내지 않고 "이 줄 녹음은 너무 길어 저장하지 않았어요". */
export const RECORDING_MAX_BYTES = 10_000_000;
/** 길이 한도. 180초에 이르면 녹음을 멈추고 현재 줄은 그대로다. */
export const RECORDING_MAX_MS = 180_000;

export type RecordingSourceKind = 'recorder' | 'stt_persist';

const EXT_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  caf: 'audio/x-caf',
  '3gp': 'audio/3gpp',
};

export function contentTypeFor(uri: string, kind: RecordingSourceKind): string {
  const name = uri.split('?')[0].split('/').pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_TYPES[ext] ?? (kind === 'recorder' ? 'audio/mp4' : 'audio/wav');
}

/** multipart 의 파일 이름. 서버는 content_type 으로 형식을 본다. */
export function fileNameFor(contentType: string): string {
  const ext = Object.entries(EXT_TYPES).find(([, type]) => type === contentType)?.[0] ?? 'm4a';
  return `line.${ext}`;
}

export type RecordingFileCheck = { ok: true } | { ok: false; reason: 'too_large' | 'too_long' | 'empty' };

/** 이보다 짧으면 말이 들어 있을 수 없다. */
export const RECORDING_MIN_MS = 300;
/**
 * 형식별로 소리가 조금이라도 든 파일의 최소 크기. 머리만 있는 파일(258바이트 m4a, 44바이트 wav)을 거른다 —
 * wav 는 16kHz·16bit 0.3초(9,600바이트), 압축 형식은 AAC 0.3초가 넉넉히 넘는 2,000바이트.
 */
export function minRecordingBytes(contentType: string | undefined): number {
  if (!contentType) return 1;
  return contentType === 'audio/wav' || contentType === 'audio/x-caf' ? 9_600 : 2_000;
}

export function checkRecordingFile(file: { byteSize: number; durationMs: number; contentType?: string }): RecordingFileCheck {
  if (file.byteSize <= 0) return { ok: false, reason: 'empty' };
  if (file.byteSize > RECORDING_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (file.durationMs > RECORDING_MAX_MS) return { ok: false, reason: 'too_long' };
  if (file.byteSize < minRecordingBytes(file.contentType)) return { ok: false, reason: 'empty' };
  if (file.durationMs > 0 && file.durationMs < RECORDING_MIN_MS) return { ok: false, reason: 'empty' };
  return { ok: true };
}

/** 줄별 시도 번호(1부터 1씩). 같은 줄을 다시 말하면 새 녹음이 이전 것을 대체한다. */
export function nextAttemptNo(attempts: Record<string, number>, lineId: string): number {
  return (attempts[lineId] ?? 0) + 1;
}

export type TranscriptFields = {
  transcript: string | null;
  transcript_source: 'stt' | 'none';
  matched: boolean | null;
};

/**
 * 전사·대조는 기기 결과만. STT 를 쓰지 않았으면 none 이고 전사·대조가 NULL 이다. matched 는 정상 인식 뒤
 * 대조 미달만 false 이고 인식 불가·무발화·한도 초과는 NULL 이다.
 */
export function transcriptFields(input: { sttUsed: boolean; text: string; match: LineMatch | null }): TranscriptFields {
  if (!input.sttUsed) return { transcript: null, transcript_source: 'none', matched: null };
  const text = input.text.trim();
  const matched = input.match?.kind === 'pass' ? true : input.match?.kind === 'miss' ? false : null;
  return { transcript: text || null, transcript_source: 'stt', matched };
}

/**
 * 상대역 목소리 준비 실패의 종류 (SOMA-494). 계측(reading_voice_failed)과 안내 문구가 이것으로 갈린다.
 * 메시지·경로 같은 원문은 계측에 보내지 않는다 — 종류만 보낸다. 줄 재생 실패만 경로를 지운 문구를 싣는다(playbackFailureFields).
 */
export type VoiceErrorKind = 'network' | 'storage' | 'parse' | 'model_load' | 'playback' | 'unknown';

const KINDS: readonly VoiceErrorKind[] = ['network', 'storage', 'parse', 'model_load', 'playback', 'unknown'];

export class VoicePrepareError extends Error {
  readonly kind: VoiceErrorKind;
  readonly neededBytes?: number;

  constructor(kind: VoiceErrorKind, message: string, extra: { neededBytes?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'VoicePrepareError';
    this.kind = kind;
    if (extra.neededBytes !== undefined) this.neededBytes = extra.neededBytes;
    if (extra.cause !== undefined) (this as { cause?: unknown }).cause = extra.cause;
  }
}

export function voiceErrorKind(e: unknown): VoiceErrorKind {
  if (!e || typeof e !== 'object') return 'unknown';
  const kind = (e as { kind?: unknown }).kind;
  if (typeof kind === 'string' && (KINDS as readonly string[]).includes(kind)) return kind as VoiceErrorKind;
  if (e instanceof SyntaxError) return 'parse';
  const message = String((e as { message?: unknown }).message ?? '');
  if (/ENOSPC|no space|not enough space|disk full|storage full/i.test(message)) return 'storage';
  if (/network|timeout|timed out|offline|unable to resolve|connection|socket|unable to download|internet|host/i.test(message)) return 'network';
  return 'unknown';
}

/**
 * 저장본을 틀지 못한 줄의 계측 칸(SOMA-1062) — 재생기 실패(failed)·정한 시간 안에 시작 안 됨(not_started)·그 밖(other)과 오류 문구.
 * 원인을 가르려고 문구를 예외로 싣되, 파일 경로는 지우고 100자(Firebase 값 한도)로 자른다.
 */
export function playbackFailureFields(e: unknown): { reason: 'failed' | 'not_started' | 'other'; message: string } {
  const raw = String((e as { message?: unknown } | null)?.message ?? e ?? '');
  const playback = voiceErrorKind(e) === 'playback';
  const reason = playback && raw.endsWith(': not_started') ? 'not_started' : playback && raw.endsWith(': failed') ? 'failed' : 'other';
  const message = raw.replace(/file:\/\/\S*|\/\S+/g, '<path>').slice(0, 100);
  return { reason, message };
}

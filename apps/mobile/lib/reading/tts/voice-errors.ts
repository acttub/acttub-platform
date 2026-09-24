/**
 * 상대역 목소리 준비 실패의 종류 (SOMA-494). 계측(reading_voice_failed)과 안내 문구가 이것으로 갈린다.
 * 메시지·경로 같은 원문은 계측에 보내지 않는다 — 종류만 보낸다.
 */
export type VoiceErrorKind = 'network' | 'storage' | 'parse' | 'model_load' | 'unknown';

const KINDS: readonly VoiceErrorKind[] = ['network', 'storage', 'parse', 'model_load', 'unknown'];

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

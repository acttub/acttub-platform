/**
 * 앱의 말한 것 글자로 바꾸기(STT)는 기기 안 처리를 보장하는 경우에만 쓰고 아니면 글자 입력("입력하기")으로
 * 바꾼다(reading.session · reading.memorization, 확정 결정 8). 언어는 앱 표시 언어다.
 */
export type SttPolicy =
  | { kind: 'stt'; requiresOnDevice: true }
  | { kind: 'typing'; reason: 'unavailable' | 'not_on_device' | 'denied' };

export function sttPolicy(input: {
  available: boolean;
  supportsOnDevice: boolean;
  permission: 'granted' | 'denied' | 'undetermined';
}): SttPolicy {
  if (!input.available) return { kind: 'typing', reason: 'unavailable' };
  if (!input.supportsOnDevice) return { kind: 'typing', reason: 'not_on_device' };
  if (input.permission !== 'granted') return { kind: 'typing', reason: 'denied' };
  return { kind: 'stt', requiresOnDevice: true };
}

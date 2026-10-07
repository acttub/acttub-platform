/**
 * 앱의 말한 것 글자로 바꾸기(STT)는 기기 안 처리를 보장하는 경우에만 쓰고, 아니면 대조하지 않는다(typing 은 옛 이름이고
 * 입력하기 화면은 없다 — reading.session). 언어는 앱 표시 언어다.
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

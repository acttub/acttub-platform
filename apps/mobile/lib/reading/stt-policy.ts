/**
 * 앱의 말한 것 글자로 바꾸기(STT)는 플랫폼 음성 인식을 쓸 수 있고 권한이 있으면 켠다(typing 은 옛 이름이고 입력하기 화면은
 * 없다 — reading.session). 기기 안 인식만 요구하지 않는다 — 기기 안 한국어 인식기가 소리를 받고도 결과를 주지 않아 리딩이
 * 통째로 멈춘 일이 있어(SOMA-741), 말소리는 OS 음성 인식 제공자(Google·Apple)가 처리할 수 있다. 언어는 그 줄의 말이고
 * (SOMA-751), 모르면 앱 표시 언어다.
 */
export type SttPolicy = { kind: 'stt' } | { kind: 'typing'; reason: 'unavailable' | 'denied' };

export function sttPolicy(input: { available: boolean; permission: 'granted' | 'denied' | 'undetermined' }): SttPolicy {
  if (!input.available) return { kind: 'typing', reason: 'unavailable' };
  if (input.permission !== 'granted') return { kind: 'typing', reason: 'denied' };
  return { kind: 'stt' };
}

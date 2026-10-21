// voice-setup 이 쓰는 음성 창구 대역. 모델 받기를 테스트가 손으로 끝내고, 기기 음성 유무를 정한다.
export const tts = { engine: "device", supported: true, voices: [{ lang: "ko-KR" }], loads: [] };

export const getEngine = () => tts.engine;
export const ttsSupported = () => tts.supported;
export const waitForVoices = async () => tts.voices;
export function enableSupertonic(onProgress) {
  return new Promise((resolve, reject) => {
    tts.loads.push({ onProgress, resolve, reject });
  });
}

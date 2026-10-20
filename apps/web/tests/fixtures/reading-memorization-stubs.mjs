// 암기 화면 테스트가 바꿔 끼우는 음성 모듈. 음성인식 세션과 원문 듣기 요청을 남기고, 테스트가 정한 값을 낸다.
export const stt = { available: false, sessions: [] };

export const sttAvailable = () => stt.available;

export function startAutoRecognition(cb) {
  const session = {
    cb,
    finished: 0,
    aborted: 0,
    finish() {
      this.finished++;
    },
    abort() {
      this.aborted++;
    },
  };
  stt.sessions.push(session);
  return session;
}

export const tts = { calls: [], unlocked: 0, result: true, gate: null };

export const unlockTts = () => {
  tts.unlocked++;
};

export async function speakDevice(text, options = {}) {
  tts.calls.push({ text, tempo: options.tempo, signal: options.signal });
  if (tts.gate) await tts.gate;
  return tts.result;
}

export function resetVoiceStubs() {
  stt.available = false;
  stt.sessions.length = 0;
  tts.calls.length = 0;
  tts.unlocked = 0;
  tts.result = true;
  tts.gate = null;
}

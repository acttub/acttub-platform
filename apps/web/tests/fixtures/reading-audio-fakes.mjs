// 음성 엔진 대역(@/lib/reading/audio/tts·mic·stt). 실제 모듈은 Supertonic(onnxruntime)·Web Audio·Web Speech 를 쓰므로
// Node 에서 돌지 않는다. 부른 것을 audio.calls 에 [이름, ...인자] 로 남기고, audio.impl[이름] 이 있으면 그 답을 쓴다.
// registerAudioFakes() 는 대상 모듈을 불러오기 전에 불러야 한다.
import { registerHooks } from "node:module";

const prelude = `
const a = () => globalThis.__readingAudio;
const call = (name, args, fallback) => {
  a().calls.push([name, ...args]);
  const f = a().impl[name];
  return f ? f(...args) : fallback();
};
`;

const modules = {
  "@/lib/reading/audio/tts": `${prelude}
export const cancelSpeech = (...x) => call("cancelSpeech", x, () => undefined);
export const clearPrefetch = (...x) => call("clearPrefetch", x, () => undefined);
export const prefetch = (...x) => call("prefetch", x, () => Promise.resolve());
export const queuePrefetch = (...x) => call("queuePrefetch", x, () => undefined);
export const setPrefetchPaused = (...x) => call("setPrefetchPaused", x, () => undefined);
export const speakWithEngine = (...x) => call("speakWithEngine", x, () => Promise.resolve(true));
export const speak = (...x) => call("speak", x, () => Promise.resolve());
export const speakDevice = (...x) => call("speakDevice", x, () => Promise.resolve(true));
export const unlockTts = (...x) => call("unlockTts", x, () => undefined);
export const enableSupertonic = (...x) => call("enableSupertonic", x, () => Promise.resolve());
export const getEngine = () => a().engine;
export const ttsSupported = () => true;
export const waitForVoices = async () => [];
export const deviceStyles = (roles) => Object.fromEntries(roles.map((r) => [r, { pitch: 1 }]));
`,
  "@/lib/reading/audio/mic": `${prelude}
export const micSupported = () => true;
export const startListening = (...x) => call("startListening", x, () => Promise.resolve({ stop: () => a().calls.push(["mic.stop"]) }));
`,
  "@/lib/reading/audio/stt": `${prelude}
export const sttAvailable = () => a().stt;
export const mergeTranscripts = (parts) => parts.join(" ");
export const startRecognition = (...x) => call("startRecognition", x, () => ({ stop() {}, abort() {} }));
export const startAutoRecognition = (...x) => call("startAutoRecognition", x, () => ({ stop() {}, abort: () => a().calls.push(["stt.abort"]) }));
`,
};

export function registerAudioFakes() {
  const audio = { calls: [], impl: {}, engine: "supertonic", stt: false };
  globalThis.__readingAudio = audio;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const source = modules[specifier];
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  return {
    audio,
    reset() {
      audio.calls = [];
      audio.impl = {};
      audio.engine = "supertonic";
      audio.stt = false;
    },
    /** 이름이 같은 호출의 인자들 */
    callsOf: (name) => audio.calls.filter((c) => c[0] === name).map((c) => c.slice(1)),
  };
}

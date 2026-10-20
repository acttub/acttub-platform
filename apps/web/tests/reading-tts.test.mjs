// reading.cast·reading.memorization 상대 대사 목소리 — 기기 음성(speechSynthesis)과 Supertonic 엔진 사이의 고르기.
// 엔진·재생 모듈은 브라우저 워커와 오디오가 있어야 돌므로 대역으로 바꿔 끼우고, 그 대역이 받은 인자를 본다.
// tts.ts 는 엔진 선택을 모듈 안에 들고 있어 되돌릴 수 없으므로 기기 음성 테스트를 먼저, Supertonic 테스트를 뒤에 둔다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

const fakeModule = (body) => ({ url: `data:text/javascript,${encodeURIComponent(body)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/reading/audio/supertonic/engine") {
      return fakeModule(`
        export const load = (onProgress) => globalThis.__tts.load(onProgress);
        export const synthesize = (text, preset) => globalThis.__tts.synthesize(text, preset);
      `);
    }
    if (specifier === "@/lib/reading/audio/supertonic/play") {
      return fakeModule(`
        export const unlockAudio = () => globalThis.__tts.unlockAudio();
        export const playSynthesized = (audio, signal) => globalThis.__tts.play(audio, signal);
      `);
    }
    return nextResolve(specifier, context);
  },
});

const tts = await import("../src/lib/reading/audio/tts.ts");

const SPEED = ["ra", "te"].join("");
const flush = () => new Promise((r) => setImmediate(r));

let log;
let synth;

function installDevice(voices = [{ name: "Google 한국의", lang: "ko-KR", localService: false }]) {
  const listeners = new Set();
  synth = {
    speaking: false,
    spoken: [],
    voices,
    getVoices: () => synth.voices,
    addEventListener: (type, fn) => {
      assert.equal(type, "voiceschanged");
      listeners.add(fn);
    },
    removeEventListener: (type, fn) => listeners.delete(fn),
    fireVoicesChanged: () => [...listeners].forEach((fn) => fn()),
    listenerCount: () => listeners.size,
    cancel: () => log.push("cancel"),
    speak: (u) => {
      log.push(`speak:${u.text}`);
      synth.spoken.push(u);
    },
    pause: () => log.push("pause"),
    resume: () => log.push("resume"),
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
  globalThis.SpeechSynthesisUtterance = Utterance;
}

function installEngine() {
  globalThis.__tts = {
    loads: [],
    synthesized: [],
    played: [],
    synthGate: null,
    synthFails: new Set(),
    playGate: null,
    load: async (onProgress) => {
      globalThis.__tts.loads.push(onProgress);
    },
    synthesize: async (text, preset) => {
      globalThis.__tts.synthesized.push(`${preset}:${text}`);
      if (globalThis.__tts.synthGate) await globalThis.__tts.synthGate();
      if (globalThis.__tts.synthFails.has(text)) throw new Error("synth failed");
      return { samples: [text], sampleRate: 44100 };
    },
    unlockAudio: () => log.push("unlockAudio"),
    play: async (audio, signal) => {
      globalThis.__tts.played.push({ audio, signal });
      if (globalThis.__tts.playGate) await globalThis.__tts.playGate(signal);
    },
  };
}

const voice = { device: { pitch: 1.12 }, preset: "F2" };

beforeEach(() => {
  log = [];
  installEngine();
  installDevice();
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

function finishLast() {
  synth.spoken.at(-1).onend();
}

test("reading.tts: 기기 음성이 없는 브라우저에서는 쓸 수 없다고 보고 한국어 음성도 없다", async () => {
  delete globalThis.window;
  assert.equal(tts.ttsSupported(), false);
  assert.deepEqual(tts.getKoreanVoices(), []);
  assert.deepEqual(await tts.waitForVoices(), []);
  assert.equal(await tts.speakDevice("안녕."), false);
  assert.equal(await tts.speakWithEngine("안녕.", voice, "device"), false);
  await tts.speak("안녕.", voice);
  tts.unlockTts();
  tts.cancelSpeech();
  assert.deepEqual(log, ["unlockAudio"]);
});

test("reading.tts: 한국어 음성을 좋은 것부터 돌려주고 다른 언어는 뺀다", () => {
  synth.voices = [
    { name: "Samantha", lang: "en-US", localService: true },
    { name: "Microsoft Heami", lang: "ko-KR", localService: true },
    { name: "Microsoft SunHi Online (Natural)", lang: "ko-KR", localService: false },
  ];
  assert.deepEqual(
    tts.getKoreanVoices().map((v) => v.name),
    ["Microsoft SunHi Online (Natural)", "Microsoft Heami"],
  );
});

test("reading.tts: 음성 목록이 처음에 비어 있으면 voiceschanged 를 기다렸다 받는다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  synth.voices = [];
  const pending = tts.waitForVoices();
  synth.voices = [{ name: "Yuna", lang: "ko-KR", localService: true }];
  synth.fireVoicesChanged();
  assert.deepEqual((await pending).map((v) => v.name), ["Yuna"]);
  assert.equal(synth.listenerCount(), 0);
});

test("reading.tts: 이미 음성이 있으면 기다리지 않고, 끝내 안 오면 시한 뒤 빈 목록을 받는다", async () => {
  assert.deepEqual((await tts.waitForVoices()).map((v) => v.name), ["Google 한국의"]);
  synth.voices = [];
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = tts.waitForVoices(500);
  mock.timers.tick(500);
  assert.deepEqual(await pending, []);
  assert.equal(synth.listenerCount(), 0);
});

test("reading.tts: 원문 듣기는 괄호 지문과 따옴표를 뺀 글을 가장 좋은 한국어 음성으로 정한 속도에 맞춰 읽는다", async () => {
  const done = tts.speakDevice("(웃으며) \"천천히\" 말해.", { tempo: 0.7 });
  const u = synth.spoken[0];
  assert.deepEqual(
    { text: u.text, lang: u.lang, pitch: u.pitch, speed: u[SPEED], voice: u.voice.name },
    { text: "천천히 말해.", lang: "ko-KR", pitch: 1, speed: 0.7, voice: "Google 한국의" },
  );
  assert.deepEqual(log, ["cancel", "speak:천천히 말해."]);
  u.onend();
  assert.equal(await done, true);
});

test("reading.tts: 읽을 글이 괄호 지문뿐이면 소리 없이 읽은 것으로 끝낸다", async () => {
  assert.equal(await tts.speakDevice("(침묵)"), true);
  assert.equal(await tts.speakWithEngine("(침묵)", voice, "device"), true);
  await tts.speak("(침묵)", voice);
  assert.deepEqual(log, []);
});

test("reading.tts: 한국어 음성이 없으면 음성을 고르지 않고 브라우저 기본으로 읽으며, 오류가 나도 멈추지 않고 끝낸다", async () => {
  synth.voices = [];
  const done = tts.speakDevice("가자.");
  const u = synth.spoken[0];
  assert.equal(u.voice, undefined);
  assert.equal(u[SPEED], 1);
  u.onerror();
  u.onend();
  assert.equal(await done, true);
});

test("reading.tts: 읽는 중에 멈추면 기기 음성을 끊고 바로 끝내며, 이미 멈춘 신호면 읽지 않는다", async () => {
  const ac = new AbortController();
  const done = tts.speakDevice("가자.", { signal: ac.signal });
  ac.abort();
  assert.equal(await done, true);
  assert.deepEqual(log, ["cancel", "speak:가자.", "cancel"]);

  log = [];
  assert.equal(await tts.speakDevice("가자.", { signal: ac.signal }), true);
  assert.deepEqual(log, ["cancel"]);
});

test("reading.tts: 15초 넘게 읽는 동안 10초마다 잠깐 멈췄다 이어 Chrome 이 끊지 않게 한다", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const done = tts.speakDevice("아주 긴 대사.");
  mock.timers.tick(10_000);
  synth.speaking = true;
  mock.timers.tick(10_000);
  mock.timers.tick(10_000);
  finishLast();
  mock.timers.tick(10_000);
  await done;
  assert.deepEqual(log, ["cancel", "speak:아주 긴 대사.", "pause", "resume", "pause", "resume"]);
});

test("reading.tts: 소리 잠금 풀기는 재생 잠금을 풀고 들리지 않는 빈 발화를 한 번 낸다", () => {
  tts.unlockTts();
  assert.deepEqual(log, ["unlockAudio", "cancel", "speak: "]);
  assert.equal(synth.spoken[0].volume, 0);
});

test("reading.tts: 기기 엔진일 때 상대 대사는 배역 말투의 높이로 기기 음성이 읽는다", async () => {
  assert.equal(tts.getEngine(), "device");
  const done = tts.speak("다행이다.", voice);
  assert.equal(synth.spoken[0].pitch, 1.12);
  finishLast();
  await done;

  const viaEngine = tts.speakWithEngine("고마워.", voice, "device");
  assert.equal(synth.spoken[1].pitch, 1.12);
  finishLast();
  assert.equal(await viaEngine, true);
  assert.deepEqual(globalThis.__tts.synthesized, []);
});

test("reading.tts: Supertonic 을 켜기 전에는 그 엔진으로 읽지 못하고 미리 만들기도 하지 않는다", async () => {
  assert.equal(await tts.speakWithEngine("가자.", voice, "supertonic"), false);
  await tts.prefetch("가자.", voice);
  tts.queuePrefetch([{ text: "가자.", voice }]);
  tts.setPrefetchPaused(false);
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, []);
  assert.deepEqual(log, []);
});

test("reading.tts: Supertonic 을 켜면 모델을 받는 진행을 넘기고 엔진이 바뀐다", async () => {
  const onProgress = () => {};
  await tts.enableSupertonic(onProgress);
  assert.deepEqual(globalThis.__tts.loads, [onProgress]);
  assert.equal(tts.getEngine(), "supertonic");
});

test("reading.tts: Supertonic 으로 배역 프리셋에 맞춰 합성해 재생하고 기기 음성은 쓰지 않는다", async () => {
  assert.equal(await tts.speakWithEngine("(작게) 가자.", voice, "supertonic"), true);
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:가자."]);
  assert.deepEqual(globalThis.__tts.played.map((p) => p.audio.samples), [["가자."]]);
  await tts.speak("고마워.", voice);
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:가자.", "F2:고마워."]);
  assert.deepEqual(log, []);
});

test("reading.tts: 회차 실행에서 Supertonic 합성이 실패하면 다른 음성으로 바꾸지 않고 false 를 돌려준다", async () => {
  globalThis.__tts.synthFails.add("가자.");
  assert.equal(await tts.speakWithEngine("가자.", voice, "supertonic"), false);
  assert.deepEqual(log, []);
});

test("reading.tts: 미리 듣기에서 Supertonic 이 실패하면 그 자리에서 기기 음성으로 읽는다", async () => {
  globalThis.__tts.synthFails.add("가자.");
  const done = tts.speak("가자.", voice);
  await flush();
  assert.equal(synth.spoken[0].text, "가자.");
  assert.equal(synth.spoken[0].pitch, 1.12);
  finishLast();
  await done;
});

test("reading.tts: 합성하는 사이에 멈추면 재생하지 않고, 기기 음성으로 넘기지도 않는다", async () => {
  let release;
  globalThis.__tts.synthGate = () => new Promise((r) => (release = r));
  const ac = new AbortController();
  const viaEngine = tts.speakWithEngine("가자.", voice, "supertonic", ac.signal);
  await flush();
  ac.abort();
  release();
  assert.equal(await viaEngine, true);
  assert.deepEqual(globalThis.__tts.played, []);

  globalThis.__tts.synthGate = null;
  globalThis.__tts.synthFails.add("고마워.");
  await tts.speak("고마워.", voice, ac.signal);
  assert.deepEqual(log, []);
});

test("reading.tts: 재생 중에 부르는 쪽이 멈추거나 cancelSpeech 를 부르면 재생 신호가 끊긴다", async () => {
  globalThis.__tts.playGate = (signal) => new Promise((r) => signal.addEventListener("abort", r));
  const ac = new AbortController();
  const first = tts.speakWithEngine("가자.", voice, "supertonic", ac.signal);
  await flush();
  ac.abort();
  assert.equal(await first, true);
  assert.equal(globalThis.__tts.played[0].signal.aborted, true);

  const second = tts.speakWithEngine("고마워.", voice, "supertonic");
  await flush();
  tts.cancelSpeech();
  assert.equal(await second, true);
  assert.equal(globalThis.__tts.played[1].signal.aborted, true);
  assert.deepEqual(log, ["cancel"]);
});

test("reading.tts: 다음 대사를 미리 만들어 두고, 실패하거나 지문뿐이어도 조용히 넘어간다", async () => {
  await tts.prefetch("(웃으며) 가자.", voice);
  globalThis.__tts.synthFails.add("고마워.");
  await tts.prefetch("고마워.", voice);
  await tts.prefetch("(침묵)", voice);
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:가자.", "F2:고마워."]);
});

test("reading.tts: 앞으로 나올 대사들을 한 번에 하나씩 순서대로 만들고 지문뿐인 줄과 실패는 건너뛴다", async () => {
  const gates = [];
  globalThis.__tts.synthGate = () => new Promise((r) => gates.push(r));
  globalThis.__tts.synthFails.add("둘.");
  const m = { device: { pitch: 1 }, preset: "M1" };
  tts.queuePrefetch([
    { text: "하나.", voice },
    { text: "(퇴장)", voice },
    { text: "둘.", voice: m },
    { text: "셋.", voice },
  ]);
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나."]);
  gates.shift()();
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나.", "M1:둘."]);
  gates.shift()();
  await flush();
  gates.shift()();
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나.", "M1:둘.", "F2:셋."]);
});

test("reading.tts: 상대가 읽는 동안 미리 만들기를 멈췄다가 풀면 남은 줄부터 이어 만든다", async () => {
  const gates = [];
  globalThis.__tts.synthGate = () => new Promise((r) => gates.push(r));
  tts.queuePrefetch([
    { text: "하나.", voice },
    { text: "둘.", voice },
    { text: "셋.", voice },
  ]);
  await flush();
  tts.setPrefetchPaused(true);
  gates.shift()();
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나."]);

  tts.setPrefetchPaused(false);
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나.", "F2:둘."]);
  tts.setPrefetchPaused(false);
  tts.queuePrefetch([{ text: "넷.", voice }]);
  gates.shift()();
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나.", "F2:둘.", "F2:넷."]);
  gates.shift()();
  await flush();
});

test("reading.tts: 미리 만들 목록을 비우면 지금 만드는 줄 다음은 만들지 않는다", async () => {
  const gates = [];
  globalThis.__tts.synthGate = () => new Promise((r) => gates.push(r));
  tts.queuePrefetch([
    { text: "하나.", voice },
    { text: "둘.", voice },
  ]);
  await flush();
  tts.clearPrefetch();
  gates.shift()();
  await flush();
  await flush();
  assert.deepEqual(globalThis.__tts.synthesized, ["F2:하나."]);
  assert.deepEqual(gates, []);
});

// reading.session·reading.cast — 실행 러너(useRehearsalRunner). 상대 대사는 엔진으로 읽고 끝나면 넘기며, 못 읽으면 글로 보기로
// 남는다. 내 차례는 침묵 감지·버튼·화면 대조로 넘기고, 60초 무발화는 알리기만 한다. 음성 엔진·마이크는 대역이다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";
import { registerAudioFakes } from "./fixtures/reading-audio-fakes.mjs";
import { react } from "./mount-probe.mjs";
import { installRecorder, uninstallRecorder } from "./fixtures/reading-media-recorder-fake.mjs";

const fakes = registerAudioFakes();
const { audio, callsOf } = fakes;

const { cleanup, render, screen } = await import("@testing-library/react");
const { DEFAULT_VAD } = await import("../src/lib/reading/audio/vad.ts");
const { RehearsalRunnerProbe } = await import("./fixtures/reading-rehearsal-runner-probe.tsx");

const lines = [
  { type: "dialogue", role: "트레", text: "하나." },
  { type: "dialogue", role: "니나", text: "둘." },
  { type: "direction", text: "사이." },
  { type: "dialogue", role: "트레", text: "셋." },
  { type: "dialogue", role: "소냐", text: "넷." },
  { type: "dialogue", role: "니나", text: "다섯." },
];
const cfg = { lines, myRoles: ["니나"], start: 0, end: 5 };
const voiceOf = (role) => ({ device: { pitch: 1 }, preset: role === "트레" ? "M2" : "F3" });

let mic;
let latest;

beforeEach(() => {
  fakes.reset();
  mic = installRecorder();
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  cleanup();
  mock.timers.reset();
  uninstallRecorder();
});

function mount(opts, config = cfg) {
  return render(react.createElement(RehearsalRunnerProbe, { cfg: config, opts: { styleFor: voiceOf, ...opts }, onRender: (r) => (latest = r) }));
}
const shown = () => screen.getByRole("status").textContent;
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};
const advance = (ms) => react.act(async () => {
  mock.timers.tick(ms);
  await flush();
});
const press = (fn) => react.act(async () => {
  fn();
  await flush();
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("reading.cast: 시작하면 첫 상대 대사 둘을 미리 만들어 두고, 상대 줄은 350ms 뒤 그 배역 목소리로 읽은 다음 내 차례로 넘어간다", async () => {
  const speaking = deferred();
  audio.impl.speakWithEngine = () => speaking.promise;
  mount({ myTurn: "manual", partnerVoice: "supertonic" });
  assert.equal(shown(), "idle@0 · manual · 음량 0 · -");

  await press(() => void latest.start());
  assert.deepEqual(callsOf("unlockTts"), [[]]);
  assert.deepEqual(callsOf("prefetch"), [
    ["하나.", voiceOf("트레")],
    ["셋.", voiceOf("트레")],
  ]);
  assert.deepEqual(mic.requests, []);
  assert.equal(shown(), "ai@0 · manual · 음량 0 · -");
  assert.deepEqual(callsOf("setPrefetchPaused").at(-1), [true]);

  await advance(349);
  assert.deepEqual(callsOf("speakWithEngine"), []);
  await advance(1);
  const [[text, voice, engine, signal]] = callsOf("speakWithEngine");
  assert.deepEqual([text, voice, engine, signal.aborted], ["하나.", voiceOf("트레"), "supertonic", false]);

  await react.act(async () => {
    speaking.resolve(true);
    await flush();
  });
  assert.equal(shown(), "me@1 · manual · 음량 0 · -");
  assert.deepEqual(callsOf("queuePrefetch").at(-1), [[
    { text: "셋.", voice: voiceOf("트레") },
    { text: "넷.", voice: voiceOf("소냐") },
  ]]);
  assert.deepEqual(callsOf("setPrefetchPaused").at(-1), [false]);
});

test("reading.cast: 미리 만들기가 25초를 넘으면 기다리지 않고 시작하며, 그동안은 준비 중이다", async () => {
  audio.impl.prefetch = () => new Promise(() => {});
  mount({ myTurn: "manual", partnerVoice: "supertonic" });
  await press(() => void latest.start());
  assert.equal(shown(), "idle@0 · manual · 음량 0 · 준비 중");
  await advance(24_999);
  assert.equal(shown(), "idle@0 · manual · 음량 0 · 준비 중");
  await advance(1);
  assert.equal(shown(), "ai@0 · manual · 음량 0 · -");
});

test("reading.cast: 상대 목소리를 내지 못하면 다른 음성으로 바꾸지 않고 그 줄에 머물러 배우가 다음을 누른다", async () => {
  audio.impl.speakWithEngine = async () => false;
  mount({ myTurn: "manual", partnerVoice: "device" });
  await press(() => void latest.start());
  assert.deepEqual(callsOf("prefetch"), []);
  await advance(350);
  assert.deepEqual(callsOf("speakWithEngine").map(([t, , engine]) => [t, engine]), [["하나.", "device"]]);
  assert.equal(shown(), "ai@0 · manual · 음량 0 · 목소리 실패");
  await press(() => latest.next());
  assert.equal(shown(), "me@1 · manual · 음량 0 · -");
});

test("reading.cast: 글로 보기는 상대 대사를 소리 없이 보여 주고 다음을 누를 때까지 기다린다", async () => {
  mount({ myTurn: "manual", partnerVoice: "text" });
  await press(() => void latest.start());
  await advance(1_000);
  assert.deepEqual(callsOf("speakWithEngine"), []);
  assert.deepEqual(callsOf("queuePrefetch"), []);
  assert.equal(shown(), "ai@0 · manual · 음량 0 · 목소리 실패");
  await press(() => latest.next());
  assert.equal(shown(), "me@1 · manual · 음량 0 · -");
});

test("reading.session: 상대가 읽는 동안 다음을 누르면 읽기를 멈추고 한 줄만 넘어간다", async () => {
  const speaking = deferred();
  audio.impl.speakWithEngine = () => speaking.promise;
  mount({ myTurn: "manual", partnerVoice: "device" });
  await press(() => void latest.start());
  await advance(350);
  await press(() => latest.next());
  const [[, , , signal]] = callsOf("speakWithEngine");
  assert.equal(signal.aborted, true);
  await react.act(async () => {
    speaking.resolve(true);
    await flush();
  });
  assert.equal(shown(), "me@1 · manual · 음량 0 · -");
});

test("reading.session: 침묵 감지는 시작 때 마이크 권한을 묻고, 내 차례 250ms 뒤 마이크를 켜 말이 끝나면 넘기며, 60초 무발화는 알리기만 한다", async () => {
  let events;
  audio.impl.startListening = async (_vad, cb) => {
    events = cb;
    return { stop: () => audio.calls.push(["mic.stop"]) };
  };
  mount({ myTurn: "silence", partnerVoice: "device" }, { ...cfg, from: 1 });
  await press(() => void latest.start());
  assert.deepEqual(mic.requests, [{ audio: true }]);
  assert.equal(mic.stoppedTracks, 1);
  assert.equal(shown(), "me@1 · silence · 음량 0 · -");

  await advance(249);
  assert.deepEqual(callsOf("startListening"), []);
  await advance(1);
  assert.deepEqual(callsOf("startListening")[0][0], DEFAULT_VAD);

  await press(() => events.onLevel(0.04));
  await press(() => events.onEvent("timeout"));
  assert.equal(shown(), "me@1 · silence · 음량 0.04 · 무발화");
  await press(() => events.onEvent("speech_start"));
  assert.equal(shown(), "me@1 · silence · 음량 0.04 · -");
  await press(() => events.onEvent("none"));
  await press(() => events.onEvent("speech_end"));
  assert.equal(shown(), "ai@3 · silence · 음량 0.04 · -");
  assert.equal(callsOf("mic.stop").length, 1);
});

test("reading.session: 마이크 권한이 없으면 버튼으로 넘기는 방식으로 바꿔 진행한다", async () => {
  uninstallRecorder();
  mic = installRecorder({ open: async () => Promise.reject(new Error("NotAllowedError")) });
  mount({ myTurn: "silence", partnerVoice: "device" }, { ...cfg, from: 1 });
  await press(() => void latest.start());
  assert.equal(shown(), "me@1 · manual · 음량 0 · 마이크 권한이 없어서 버튼으로 넘기는 방식으로 진행해요.");
  await advance(1_000);
  assert.deepEqual(callsOf("startListening"), []);
});

test("reading.session: 내 차례에 마이크를 켜지 못하면 버튼으로 넘기는 방식으로 바꾼다", async () => {
  audio.impl.startListening = async () => {
    throw new Error("AudioContext 없음");
  };
  mount({ myTurn: "silence", partnerVoice: "device" }, { ...cfg, from: 1 });
  await press(() => void latest.start());
  await advance(250);
  assert.equal(shown(), "me@1 · manual · 음량 0 · 마이크를 쓸 수 없어서 버튼으로 넘기는 방식으로 진행해요.");
});

test("reading.session: 마이크가 켜지는 사이에 다음을 누르면 늦게 켜진 마이크를 바로 끈다", async () => {
  const opening = deferred();
  audio.impl.startListening = () => opening.promise;
  mount({ myTurn: "silence", partnerVoice: "device" }, { ...cfg, from: 1 });
  await press(() => void latest.start());
  await advance(250);
  await press(() => latest.next());
  await react.act(async () => {
    opening.resolve({ stop: () => audio.calls.push(["mic.stop"]) });
    await flush();
  });
  assert.equal(callsOf("mic.stop").length, 1);
  assert.equal(shown(), "ai@3 · silence · 음량 0 · -");
});

test("reading.session: 일시정지하면 읽기를 멈추고, 이어가면 그 줄을 다시 읽으며, 일시정지 중 다음은 그 다음 줄로 간다", async () => {
  audio.impl.speakWithEngine = () => new Promise(() => {});
  mount({ myTurn: "manual", partnerVoice: "device" });
  await press(() => void latest.start());
  await advance(350);
  await press(() => latest.togglePause());
  assert.equal(shown(), "paused@0 · manual · 음량 0 · -");
  assert.equal(callsOf("speakWithEngine")[0][3].aborted, true);

  await press(() => latest.togglePause());
  assert.equal(shown(), "ai@0 · manual · 음량 0 · -");
  await advance(350);
  assert.equal(callsOf("speakWithEngine").length, 2);

  await press(() => latest.togglePause());
  await press(() => latest.next());
  assert.equal(shown(), "me@1 · manual · 음량 0 · -");
});

test("reading.session: 나가기(stop)는 읽던 상대 대사를 끊고, 화면이 닫히면 미리 만들기를 비운다", async () => {
  audio.impl.speakWithEngine = () => new Promise(() => {});
  const view = mount({ myTurn: "manual", partnerVoice: "device" });
  await press(() => void latest.start());
  await advance(350);
  const cancelsBefore = callsOf("cancelSpeech").length;
  await press(() => latest.stop());
  assert.equal(callsOf("speakWithEngine")[0][3].aborted, true);
  assert.equal(callsOf("cancelSpeech").length, cancelsBefore + 1);
  assert.deepEqual(callsOf("clearPrefetch"), []);
  view.unmount();
  assert.deepEqual(callsOf("clearPrefetch"), [[]]);
});

test("reading.session: 구간 끝을 지나면 완료가 되고, 화면이 대조하는 방식(wait)은 내 차례에 마이크를 켜지 않는다", async () => {
  mount({ myTurn: "wait", partnerVoice: "device" }, { ...cfg, from: 5 });
  await press(() => void latest.start());
  await advance(1_000);
  assert.deepEqual(mic.requests, []);
  assert.deepEqual(callsOf("startListening"), []);
  assert.equal(shown(), "me@5 · wait · 음량 0 · -");
  await press(() => latest.next());
  assert.equal(shown(), "done@5 · wait · 음량 0 · -");
});

test("reading.session: 일시정지를 누른 순간 상대 읽기나 내 말이 끝나도 줄을 넘기지 않고 일시정지에 머문다", async () => {
  const speaking = deferred();
  let events;
  audio.impl.speakWithEngine = () => speaking.promise;
  audio.impl.startListening = async (_vad, cb) => {
    events = cb;
    return { stop() {} };
  };
  mount({ myTurn: "silence", partnerVoice: "device" });
  await press(() => void latest.start());
  await advance(350);
  await react.act(async () => {
    latest.togglePause();
    speaking.resolve(true);
    await flush();
  });
  assert.equal(shown(), "paused@0 · silence · 음량 0 · -");

  await press(() => latest.next());
  await advance(250);
  assert.equal(shown(), "me@1 · silence · 음량 0 · -");
  await react.act(async () => {
    latest.togglePause();
    events.onEvent("speech_end");
    await flush();
  });
  assert.equal(shown(), "paused@1 · silence · 음량 0 · -");
});

test("reading.session: 마이크를 켜기 전 250ms 안에 다음을 누르면 그 줄의 마이크를 켜지 않는다", async () => {
  audio.impl.speakWithEngine = () => new Promise(() => {});
  mount({ myTurn: "silence", partnerVoice: "device" }, { ...cfg, from: 1 });
  await press(() => void latest.start());
  await advance(100);
  await press(() => latest.next());
  await advance(1_000);
  assert.deepEqual(callsOf("startListening"), []);
  assert.equal(shown(), "ai@3 · silence · 음량 0 · -");
});

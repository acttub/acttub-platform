// 합성된 소리 재생(play.ts). 브라우저 오디오 재생기를 대역으로 심고, 재생기 사건(playing·ended·error)과
// 타이머를 흘려 보내 약속이 언제 끝나는지·어떤 오류로 끝나는지와 재생기에 넘긴 wav 를 본다.
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { registerHooks } from "node:module";
import { afterEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "onnxruntime-web") {
      return { url: new URL("./fixtures/reading-supertonic-ort.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const audios = [];
let playImpl = () => Promise.resolve();
class FakeAudio {
  constructor() {
    this.src = "";
    this.preload = "";
    this.plays = [];
    this.pauses = 0;
    audios.push(this);
  }
  play() {
    this.plays.push(this.src);
    return playImpl();
  }
  pause() {
    this.pauses++;
  }
}

const { playSynthesized, unlockAudio } = await import("../src/lib/reading/audio/supertonic/play.ts");

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const player = () => audios[0];
const settle = (p) =>
  Promise.race([
    p.then(
      () => "resolved",
      (e) => `rejected ${e.name}: ${e.message}`,
    ),
    new Promise((resolve) => setImmediate(() => resolve("pending"))),
  ]);
const oneSecond = { samples: new Float32Array(8000), sampleRate: 8000, duration: 1 };

afterEach(() => {
  playImpl = () => Promise.resolve();
  mock.timers.reset();
});

test("reading.supertonic-play: 창이 없는 곳에서는 재생기를 만들지 않고 바로 끝내고, 창이 생기면 무음으로 재생기를 열어 둔다", async () => {
  unlockAudio();
  assert.equal(await settle(playSynthesized(oneSecond)), "resolved");
  assert.equal(audios.length, 0);

  globalThis.window = {};
  globalThis.Audio = FakeAudio;
  playImpl = () => Promise.reject(new Error("NotAllowedError"));
  unlockAudio();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(audios.length, 1);
  assert.equal(player().preload, "auto");
  assert.deepEqual(player().plays, [SILENT_WAV]);
});

test("reading.supertonic-play: 합성된 소리를 wav 로 만들어 틀고, 끝까지 울리면 끝난다", async () => {
  const done = playSynthesized({ samples: new Float32Array([0, 0.5]), sampleRate: 8000, duration: 0.00025 });
  const a = player();

  assert.equal(a.plays.at(-1), a.src);
  const blob = resolveObjectURL(a.src);
  assert.equal(blob.type, "audio/wav");
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.byteLength, 48);
  assert.equal(view.getUint32(24, true), 8000);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true)], [0, 16383]);

  a.onplaying();
  assert.equal(await settle(done), "pending");
  a.onended();
  assert.equal(await settle(done), "resolved");
  assert.equal(a.onended, null);
});

test("reading.supertonic-play: 다음 대사를 틀면 앞의 것을 멈추고 앞의 wav 주소를 풀어 준다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  playSynthesized(oneSecond);
  const a = player();
  const firstUrl = a.src;
  a.onplaying();
  const pausesBefore = a.pauses;

  const second = playSynthesized(oneSecond);

  assert.equal(a.pauses, pausesBefore + 1);
  assert.equal(resolveObjectURL(firstUrl), undefined);
  assert.notEqual(a.src, firstUrl);
  assert.ok(resolveObjectURL(a.src));
  a.onplaying();
  a.onended();
  assert.equal(await settle(second), "resolved");
});

test("reading.supertonic-play: 이미 취소됐거나 진폭이 깨진 소리는 틀지 않는다", async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const a = player();
  const playsBefore = a.plays.length;
  try {
    const controller = new AbortController();
    controller.abort();
    assert.equal(await settle(playSynthesized(oneSecond, controller.signal)), "resolved");
    assert.equal(await settle(playSynthesized({ samples: new Float32Array([0.1, 40]), sampleRate: 8000, duration: 1 })), "resolved");
  } finally {
    console.error = realError;
  }

  assert.equal(a.plays.length, playsBefore);
  assert.deepEqual(errors, ["[tts] 합성 결과가 정상 범위를 벗어나 재생하지 않는다."]);
});

test("reading.supertonic-play: 시작 전에 재생기가 오류를 내면 기기 음성으로 넘기도록 시작 실패로 끝내고, 뒤늦은 재생 거절은 이유를 바꾸지 않는다", async () => {
  playImpl = () => Promise.reject(new Error("AbortError"));
  const done = playSynthesized(oneSecond);
  const pausesBefore = player().pauses;

  player().onerror();

  assert.equal(await settle(done), "rejected PlaybackStalledError: 재생기가 시작하지 않는다");
  assert.equal(player().pauses, pausesBefore + 1);
});

test("reading.supertonic-play: 시작한 뒤의 오류는 끊긴 것으로 보고 다음으로 넘어가게 끝낸다", async () => {
  const done = playSynthesized(oneSecond);
  player().onplaying();
  player().onerror();
  assert.equal(await settle(done), "resolved");
});

test("reading.supertonic-play: 재생 요청이 시작 전에 거절되면 재생 요청 실패로 끝내고, 시작한 뒤의 거절은 무시한다", async () => {
  playImpl = () => Promise.reject(new Error("NotAllowedError"));
  assert.equal(await settle(playSynthesized(oneSecond)), "rejected PlaybackStalledError: 재생 요청이 실패했다");

  const late = playSynthesized(oneSecond);
  player().onplaying();
  assert.equal(await settle(late), "pending");
  player().onended();
  assert.equal(await settle(late), "resolved");
});

test("reading.supertonic-play: 3초 안에 시작하지 않으면 굳은 것으로 보고 시작 실패로 끝낸다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  playImpl = () => new Promise(() => {});
  const done = playSynthesized(oneSecond);

  mock.timers.tick(2999);
  assert.equal(await settle(done), "pending");
  mock.timers.tick(1);
  assert.equal(await settle(done), "rejected PlaybackStalledError: 재생기가 시작하지 않는다");
});

test("reading.supertonic-play: 시작한 뒤 소리 길이에 2초를 더해도 안 끝나면 끝난 것으로 친다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const done = playSynthesized(oneSecond);

  player().onplaying();
  mock.timers.tick(1500);
  player().onplaying();
  mock.timers.tick(1499);
  assert.equal(await settle(done), "pending");
  mock.timers.tick(1);
  assert.equal(await settle(done), "resolved");
});

test("reading.supertonic-play: 재생 중에 취소되면 재생기를 멈추고 조용히 끝낸다", async () => {
  const controller = new AbortController();
  const done = playSynthesized(oneSecond, controller.signal);
  player().onplaying();
  const pausesBefore = player().pauses;

  controller.abort();

  assert.equal(await settle(done), "resolved");
  assert.equal(player().pauses, pausesBefore + 1);
  assert.equal(player().onplaying, null);
});

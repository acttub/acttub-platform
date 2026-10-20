// reading.session 마이크 침묵 감지 — 마이크에서 음량 숫자만 뽑아 감지기에 넣고, 멈추면 마이크를 끈다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

const { micSupported, startListening } = await import("../src/lib/reading/audio/mic.ts");

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const setNavigator = (value) => Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });

let now = 0;
let loudness = 0;
let world;

function installMic() {
  world = { constraints: [], log: [], contexts: [] };
  const track = (kind) => ({ stop: () => world.log.push(`track.stop:${kind}`) });
  const stream = { getTracks: () => [track("audio")] };
  setNavigator({
    mediaDevices: {
      getUserMedia: async (constraints) => {
        world.constraints.push(constraints);
        return stream;
      },
    },
  });
  globalThis.AudioContext = class {
    constructor() {
      world.contexts.push(this);
      this.analyser = {
        fftSize: 0,
        getFloatTimeDomainData: (buf) => {
          world.bufferLength = buf.length;
          buf.fill(loudness);
        },
      };
    }
    createMediaStreamSource(s) {
      assert.equal(s, stream);
      return {
        connect: (node) => world.log.push(node === this.analyser ? "connect:analyser" : "connect:?"),
        disconnect: () => world.log.push("source.disconnect"),
      };
    }
    createAnalyser() {
      return this.analyser;
    }
    close() {
      world.log.push("ctx.close");
      return Promise.resolve();
    }
  };
}

const opts = { threshold: 0.1, silenceMs: 200, minSpeechMs: 100, maxListenMs: 1000 };

function step(ms, rms) {
  loudness = rms;
  for (let t = 0; t < ms; t += 50) {
    now += 50;
    mock.timers.tick(50);
  }
}

beforeEach(() => {
  now = 0;
  loudness = 0;
  mock.method(performance, "now", () => now);
  mock.timers.enable({ apis: ["setInterval"] });
  installMic();
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  delete globalThis.AudioContext;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
});

test("reading.mic: getUserMedia 가 있을 때만 마이크를 쓸 수 있다고 본다", () => {
  assert.equal(micSupported(), true);
  setNavigator({});
  assert.equal(micSupported(), false);
  setNavigator({ mediaDevices: {} });
  assert.equal(micSupported(), false);
});

test("reading.mic: 에코·잡음 제거와 자동 음량을 켠 소리만 요청하고 영상은 요청하지 않는다", async () => {
  const l = await startListening(opts, { onEvent: () => {} });
  assert.deepEqual(world.constraints, [
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false },
  ]);
  assert.deepEqual(world.log, ["connect:analyser"]);
  assert.equal(world.contexts[0].analyser.fftSize, 2048);
  l.stop();
});

test("reading.mic: 50ms 마다 음량을 알리고, 말 시작과 말 끝만 사건으로 알린다", async () => {
  const volumes = [];
  const events = [];
  const l = await startListening(opts, { onEvent: (e) => events.push(`${e}@${now}`), onLevel: (r) => volumes.push(r) });
  step(100, 0);
  step(150, 0.5);
  step(200, 0);
  assert.deepEqual(events, ["speech_start@150", "speech_end@450"]);
  assert.equal(volumes.length, 9);
  assert.deepEqual([...new Set(volumes.map((r) => Math.round(r * 10) / 10))], [0, 0.5]);
  assert.equal(world.bufferLength, 2048);
  l.stop();
});

test("reading.mic: 아무 말 없이 maxListenMs 가 지나면 timeout 을 알린다", async () => {
  const events = [];
  const l = await startListening(opts, { onEvent: (e) => events.push(`${e}@${now}`) });
  step(1000, 0);
  assert.deepEqual(events, ["timeout@1000"]);
  l.stop();
});

test("reading.mic: 멈추면 마이크 트랙을 끄고 오디오를 닫으며, 그 뒤로는 아무것도 알리지 않는다", async () => {
  const events = [];
  const volumes = [];
  const l = await startListening(opts, { onEvent: (e) => events.push(e), onLevel: (r) => volumes.push(r) });
  step(50, 0);
  l.stop();
  l.stop();
  step(1500, 0.5);
  assert.deepEqual(world.log, ["connect:analyser", "track.stop:audio", "source.disconnect", "ctx.close"]);
  assert.deepEqual(events, []);
  assert.deepEqual(volumes, [0]);
});

test("reading.mic: 마이크 권한이 거부되면 그 오류를 그대로 던지고 오디오를 열지 않는다", async () => {
  setNavigator({ mediaDevices: { getUserMedia: async () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })) } });
  await assert.rejects(startListening(opts, { onEvent: () => {} }), { name: "NotAllowedError" });
  assert.deepEqual(world.contexts, []);
});

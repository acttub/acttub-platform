// reading.memorization·reading.session 의 기기 STT — 브라우저 SpeechRecognition 을 감싼 부분.
// 인앱 브라우저는 객체만 있고 시작하지 않으므로 start 이벤트가 안 오면 "unavailable" 로 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

globalThis.window = {};
const { sttAvailable, startRecognition, startAutoRecognition } = await import("../src/lib/reading/audio/stt.ts");

class FakeRecognition {
  static made = [];
  static startThrows = false;
  static autoStart = true;
  lang = "";
  interimResults = false;
  continuous = null;
  maxAlternatives = 0;
  onresult = null;
  onerror = null;
  onend = null;
  onstart = null;
  calls = [];
  stopThrows = false;
  abortThrows = false;
  constructor() {
    FakeRecognition.made.push(this);
  }
  start() {
    this.calls.push("start");
    if (FakeRecognition.startThrows) throw new Error("InvalidStateError");
    if (FakeRecognition.autoStart) this.onstart?.();
  }
  stop() {
    this.calls.push("stop");
    if (this.stopThrows) throw new Error("stop");
    this.onend?.();
  }
  abort() {
    this.calls.push("abort");
    if (this.abortThrows) throw new Error("abort");
  }
  hear(...transcripts) {
    this.onresult?.({ results: transcripts.map((t) => [{ transcript: t }]) });
  }
}

function recorder() {
  const events = [];
  return {
    events,
    cb: {
      onStart: () => events.push("start"),
      onInterim: (t) => events.push(`interim:${t}`),
      onText: (t) => events.push(`text:${t}`),
      onError: (r) => events.push(`error:${r}`),
    },
  };
}

beforeEach(() => {
  FakeRecognition.made = [];
  FakeRecognition.startThrows = false;
  FakeRecognition.autoStart = true;
  globalThis.window = { SpeechRecognition: FakeRecognition };
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

test("reading.stt: 표준 이름이나 webkit 이름 중 하나라도 있으면 쓸 수 있고, 둘 다 없으면 못 쓴다", () => {
  assert.equal(sttAvailable(), true);
  globalThis.window = { webkitSpeechRecognition: FakeRecognition };
  assert.equal(sttAvailable(), true);
  globalThis.window = {};
  assert.equal(sttAvailable(), false);
});

test("reading.stt: 인식기가 없으면 바로 unavailable 을 알리고 돌려준 손잡이는 아무 일도 하지 않는다", () => {
  globalThis.window = {};
  const { events, cb } = recorder();
  const l = startRecognition(cb);
  assert.deepEqual(events, ["error:unavailable"]);
  l.stop();
  l.abort();
  mock.timers.tick(5000);
  assert.deepEqual(events, ["error:unavailable"]);
});

test("reading.stt: 한국어로, 중간 결과를 받으며, 부르는 쪽이 정한 연속 여부로 인식기를 연다", () => {
  startRecognition(recorder().cb, false);
  const [r] = FakeRecognition.made;
  assert.deepEqual(
    { lang: r.lang, interimResults: r.interimResults, continuous: r.continuous, maxAlternatives: r.maxAlternatives, calls: r.calls },
    { lang: "ko-KR", interimResults: true, continuous: false, maxAlternatives: 1, calls: ["start"] },
  );
  startRecognition(recorder().cb);
  assert.equal(FakeRecognition.made[1].continuous, true);
});

test("reading.stt: 2.5초 안에 시작하지 않으면 인식기를 끊고 unavailable 을 한 번만 알린다", () => {
  FakeRecognition.autoStart = false;
  const { events, cb } = recorder();
  startRecognition(cb);
  const [r] = FakeRecognition.made;
  mock.timers.tick(2499);
  assert.deepEqual(events, []);
  r.abortThrows = true;
  mock.timers.tick(1);
  assert.deepEqual(r.calls, ["start", "abort"]);
  assert.deepEqual(events, ["error:unavailable"]);
  r.onerror({ error: "aborted" });
  r.onend();
  assert.deepEqual(events, ["error:unavailable"]);
});

test("reading.stt: 시작한 뒤에는 2.5초가 지나도 unavailable 을 알리지 않고, 멈추면 들은 말을 넘긴다", () => {
  const { events, cb } = recorder();
  const l = startRecognition(cb);
  const [r] = FakeRecognition.made;
  r.hear("너 맨날 ");
  mock.timers.tick(3000);
  l.stop();
  assert.deepEqual(events, ["start", "interim:너 맨날", "text:너 맨날"]);
});

test("reading.stt: onStart·onInterim 을 넘기지 않아도 들은 말을 넘긴다", () => {
  const got = [];
  const l = startRecognition({ onText: (t) => got.push(t), onError: (r) => got.push(`error:${r}`) });
  FakeRecognition.made[0].hear("가자", "  ");
  l.stop();
  assert.deepEqual(got, ["가자"]);
});

test("reading.stt: 브라우저 오류 이름을 권한 거부·무발화·실패 셋으로 줄여 한 번만 알린다", () => {
  const cases = [
    ["not-allowed", "error:denied"],
    ["service-not-allowed", "error:denied"],
    ["no-speech", "error:no-speech"],
    ["network", "error:failed"],
    [undefined, "error:failed"],
  ];
  for (const [error, expected] of cases) {
    const { events, cb } = recorder();
    startRecognition(cb);
    const r = FakeRecognition.made.at(-1);
    r.onerror({ error });
    r.onerror({ error: "network" });
    r.onend();
    mock.timers.tick(3000);
    assert.deepEqual(events, ["start", expected], String(error));
  }
});

test("reading.stt: start 가 던지면 failed 를 알리고 시작 시한이 지나도 다시 알리지 않는다", () => {
  FakeRecognition.startThrows = true;
  const { events, cb } = recorder();
  startRecognition(cb);
  mock.timers.tick(3000);
  assert.deepEqual(events, ["error:failed"]);
});

test("reading.stt: 멈춤이 던져도 삼키고, 중단하면 그 뒤의 결과를 넘기지 않는다", () => {
  const { events, cb } = recorder();
  const l = startRecognition(cb);
  const [r] = FakeRecognition.made;
  r.stopThrows = true;
  l.stop();
  r.abortThrows = true;
  l.abort();
  r.onend();
  r.onerror({ error: "aborted" });
  assert.deepEqual(r.calls, ["start", "stop", "abort"]);
  assert.deepEqual(events, ["start"]);
});

test("reading.stt: 시작 전에 중단하면 시작 시한이 지나도 unavailable 을 알리지 않는다", () => {
  FakeRecognition.autoStart = false;
  const { events, cb } = recorder();
  startRecognition(cb).abort();
  mock.timers.tick(5000);
  assert.deepEqual(events, []);
});

test("reading.stt: 따로 넘기지 않으면 브라우저 인식기로 듣고, 말이 1.8초 멈추면 들은 말로 확정한다", () => {
  const events = [];
  startAutoRecognition({
    onListening: () => events.push("listening"),
    onInterim: (t) => events.push(`interim:${t}`),
    onText: (t) => events.push(`text:${t}`),
    onError: (r) => events.push(`error:${r}`),
  });
  const [r] = FakeRecognition.made;
  assert.equal(r.continuous, true);
  r.hear("다행이다");
  mock.timers.tick(1799);
  assert.deepEqual(r.calls, ["start"]);
  mock.timers.tick(1);
  assert.deepEqual(r.calls, ["start", "stop"]);
  assert.deepEqual(events, ["listening", "interim:다행이다", "text:다행이다"]);
});

function fakeDeps() {
  const opened = [];
  return {
    opened,
    deps: {
      startRec(cb) {
        const handle = {
          cb,
          heard: "",
          calls: [],
          stop() {
            handle.calls.push("stop");
            cb.onText(handle.heard);
          },
          abort() {
            handle.calls.push("abort");
          },
        };
        opened.push(handle);
        cb.onStart?.();
        return handle;
      },
    },
  };
}

function autoRecorder() {
  const events = [];
  return {
    events,
    cb: {
      onListening: () => events.push("listening"),
      onInterim: (t) => events.push(`interim:${t}`),
      onText: (t) => events.push(`text:${t}`),
      onError: (r) => events.push(`error:${r}`),
    },
  };
}

test("reading.stt: 다시 연 인식기에서는 듣기 시작을 다시 알리지 않는다", () => {
  const { opened, deps } = fakeDeps();
  const { events, cb } = autoRecorder();
  startAutoRecognition(cb, deps);
  opened[0].cb.onError("no-speech");
  assert.equal(opened.length, 2);
  assert.deepEqual(events, ["listening"]);
});

test("reading.stt: 오래 들었는데 들은 말이 있으면 포기하지 않고 그 말로 확정한다", () => {
  const { opened, deps } = fakeDeps();
  const { events, cb } = autoRecorder();
  startAutoRecognition(cb, deps, { maxListenMs: 5000, silenceMs: 10_000 });
  opened[0].cb.onInterim("너 맨날");
  opened[0].cb.onError("no-speech");
  opened[1].heard = "그러잖아";
  mock.timers.tick(5000);
  assert.deepEqual(opened[1].calls, ["stop"]);
  assert.deepEqual(events, ["listening", "interim:너 맨날", "text:너 맨날 그러잖아"]);
});

test("reading.stt: 끝난 뒤에 늦게 온 중간 결과·확정·오류는 무시한다", () => {
  const { opened, deps } = fakeDeps();
  const { events, cb } = autoRecorder();
  startAutoRecognition(cb, deps);
  const live = opened[0].cb;
  live.onError("denied");
  live.onInterim("늦은 말");
  live.onText("늦은 말");
  live.onError("failed");
  live.onError("no-speech");
  mock.timers.tick(120_000);
  assert.equal(opened.length, 1);
  assert.deepEqual(events, ["listening", "error:denied"]);
});

test("reading.stt: 확정한 뒤에 늦게 온 오류는 무시하고, 중단한 뒤에는 시작 알림도 내지 않는다", () => {
  const { opened, deps } = fakeDeps();
  const { events, cb } = autoRecorder();
  const handle = startAutoRecognition(cb, deps);
  opened[0].cb.onText("가자");
  opened[0].cb.onError("failed");
  handle.abort();
  opened[0].cb.onStart();
  assert.deepEqual(opened[0].calls, ["abort"]);
  assert.deepEqual(events, ["listening", "text:가자"]);
});

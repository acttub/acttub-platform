// reading.recording — 내 차례 한 줄을 MediaRecorder 로 녹음한다. 브라우저 형식을 고르고, 180초에 스스로 멈추며,
// 버리면 소리를 남기지 않고 마이크를 놓는다. MediaRecorder·getUserMedia 는 이 파일 안의 대역이다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

import { FakeMediaRecorder, installRecorder, uninstallRecorder } from "./fixtures/reading-media-recorder-fake.mjs";

const { appleMobileWebKit, recorderSupported, startLineRecording } = await import("../src/lib/reading/recording/recorder.ts");

let mic;

beforeEach(() => {
  mic = installRecorder();
});

afterEach(() => {
  mock.timers.reset();
  uninstallRecorder();
});

test("reading.recording: 마이크와 MediaRecorder 가 있고 낼 수 있는 형식이 있어야 녹음을 켤 수 있다", () => {
  assert.equal(recorderSupported(), true);

  FakeMediaRecorder.supported = new Set();
  assert.equal(recorderSupported(), false);

  FakeMediaRecorder.supported = new Set(["audio/mp4"]);
  installRecorder({ getUserMedia: false });
  FakeMediaRecorder.supported = new Set(["audio/mp4"]);
  assert.equal(recorderSupported(), false);

  installRecorder();
  delete globalThis.MediaRecorder;
  assert.equal(recorderSupported(), false);
});

test("reading.recording: 아이폰·아이패드 웹(사파리·크롬)은 녹음을 끈다 — 첫 줄 뒤 파일이 깨진다(SOMA-1083)", () => {
  const ua = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const touch = Object.getOwnPropertyDescriptor(globalThis.navigator, "maxTouchPoints");
  const setNav = (userAgent, maxTouchPoints = 0) => {
    Object.defineProperty(globalThis.navigator, "userAgent", { value: userAgent, configurable: true });
    Object.defineProperty(globalThis.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
  };
  try {
    setNav("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1", 5);
    assert.equal(appleMobileWebKit(), true);
    assert.equal(recorderSupported(), false);
    setNav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", 5);
    assert.equal(appleMobileWebKit(), true);
    setNav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", 0);
    assert.equal(appleMobileWebKit(), false);
    assert.equal(recorderSupported(), true);
    setNav("Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36", 5);
    assert.equal(appleMobileWebKit(), false);
    assert.equal(recorderSupported(), true);
  } finally {
    if (ua) Object.defineProperty(globalThis.navigator, "userAgent", ua);
    else delete globalThis.navigator.userAgent;
    if (touch) Object.defineProperty(globalThis.navigator, "maxTouchPoints", touch);
    else delete globalThis.navigator.maxTouchPoints;
  }
});

test("reading.recording: 녹음은 잡음·울림을 줄인 마이크를 열고 브라우저가 내는 webm/opus 로 1초마다 조각을 받아, 멈추면 조각을 합친 파일과 길이를 준다", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
  const rec = await startLineRecording();
  const media = FakeMediaRecorder.instances[0];
  assert.deepEqual(mic.requests, [{ audio: { echoCancellation: true, noiseSuppression: true }, video: false }]);
  assert.deepEqual(media.options, { mimeType: "audio/webm;codecs=opus" });
  assert.equal(media.timeslice, 1000);

  media.emit(3);
  media.emit(0);
  mock.timers.tick(2_500);
  media.tail = [4];
  const clip = await rec.stop();

  assert.equal(clip.blob.size, 7);
  assert.equal(clip.blob.type, "audio/webm;codecs=opus");
  assert.equal(clip.contentType, "audio/webm;codecs=opus");
  assert.equal(clip.durationMs, 2_500);
  assert.equal(mic.stoppedTracks, 1);
});

test("reading.recording: 브라우저가 recorder.mimeType 을 비워 두면 고른 형식을 content_type 으로 쓴다", async () => {
  FakeMediaRecorder.supported = new Set(["audio/mp4"]);
  const rec = await startLineRecording();
  const media = FakeMediaRecorder.instances[0];
  media.mimeType = "";
  media.emit(2);
  const clip = await rec.stop();
  assert.equal(clip.contentType, "audio/mp4");
  assert.equal(clip.blob.type, "audio/mp4");
});

test("reading.recording: 아무 소리도 담기지 않았으면 멈춘 결과가 null 이다", async () => {
  const rec = await startLineRecording();
  assert.equal(await rec.stop(), null);
  assert.equal(mic.stoppedTracks, 1);
});

test("reading.recording: 180초에 이르면 녹음이 스스로 멈추고, 그때까지의 소리를 180초 길이로 준다", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const rec = await startLineRecording();
  const media = FakeMediaRecorder.instances[0];
  media.emit(5);
  mock.timers.tick(179_999);
  assert.equal(media.state, "recording");
  mock.timers.tick(1);
  assert.equal(media.state, "inactive");

  mock.timers.tick(5_000);
  const clip = await rec.stop();
  assert.equal(clip.durationMs, 180_000);
  assert.equal(clip.blob.size, 5);
});

test("reading.recording: 버리면 늦게 온 조각까지 남기지 않고 마이크를 놓는다", async () => {
  const rec = await startLineRecording();
  const media = FakeMediaRecorder.instances[0];
  media.emit(3);
  media.tail = [4];
  rec.cancel();
  assert.equal(media.state, "inactive");
  assert.equal(await rec.stop(), null);
  assert.equal(mic.stoppedTracks, 1);
});

test("reading.recording: 180초로 이미 멈춘 녹음을 버려도 마이크를 놓는다", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const rec = await startLineRecording();
  const media = FakeMediaRecorder.instances[0];
  media.stop = () => {
    media.state = "inactive";
  };
  mock.timers.tick(180_000);
  assert.equal(mic.stoppedTracks, 0);
  rec.cancel();
  assert.equal(mic.stoppedTracks, 1);
});

test("reading.recording: 낼 수 있는 녹음 형식이 없으면 마이크를 열지 않고 알린다", async () => {
  FakeMediaRecorder.supported = new Set();
  await assert.rejects(startLineRecording(), { message: "이 브라우저는 녹음 형식을 지원하지 않아요." });
  assert.deepEqual(mic.requests, []);
});

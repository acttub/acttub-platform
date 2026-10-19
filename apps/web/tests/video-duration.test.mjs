import assert from "node:assert/strict";
import { File, resolveObjectURL } from "node:buffer";
import { afterEach, beforeEach, test } from "node:test";

import { JSDOM, VirtualConsole } from "jsdom";

import "./ts-module-loader.mjs";

const { videoDuration } = await import("../src/lib/media/video-duration.ts");

// jsdom 은 미디어를 읽지 않는다. 브라우저가 할 일(duration 채우기, loadedmetadata·error 발생)을
// 테스트가 만든 <video> 요소에 직접 일으킨다. 빈 VirtualConsole 은 jsdom 의 "load() 미구현" 경고를 버린다.
let window;
let createdVideos;
let onCreateVideo;

beforeEach(() => {
  ({ window } = new JSDOM("", { virtualConsole: new VirtualConsole() }));
  createdVideos = [];
  onCreateVideo = null;
  const { document } = window;
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    const element = createElement(tagName);
    if (tagName === "video") {
      createdVideos.push(element);
      onCreateVideo?.(element);
    }
    return element;
  };
  globalThis.document = document;
});

afterEach(() => {
  delete globalThis.document;
});

function videoFile() {
  return new File(["video-bytes"], "take.mp4", { type: "video/mp4" });
}

function onlyVideo() {
  assert.equal(createdVideos.length, 1);
  return createdVideos[0];
}

function loadMetadata(video, seconds) {
  if (seconds !== undefined) Object.defineProperty(video, "duration", { value: seconds, configurable: true });
  video.dispatchEvent(new window.Event("loadedmetadata"));
}

test("메타데이터만 읽어 길이를 ms로 반올림해 돌려주고 임시 주소를 해제한다", async () => {
  const pending = videoDuration(videoFile());
  const video = onlyVideo();
  const objectUrl = video.src;

  assert.equal(video.preload, "metadata");
  assert.match(objectUrl, /^blob:/);
  assert.equal(await resolveObjectURL(objectUrl).text(), "video-bytes");

  loadMetadata(video, 12.3456);

  assert.equal(await pending, 12_346);
  assert.equal(resolveObjectURL(objectUrl), undefined);
});

test("길이가 유한한 양수가 아니면 길이를 확인하지 못했다고 알린다", async () => {
  for (const seconds of [undefined, Number.POSITIVE_INFINITY, 0]) {
    createdVideos = [];
    const pending = videoDuration(videoFile());
    const video = onlyVideo();
    const objectUrl = video.src;

    loadMetadata(video, seconds);

    await assert.rejects(pending, { message: "영상 길이를 확인하지 못했어요." });
    assert.equal(resolveObjectURL(objectUrl), undefined);
  }
});

test("브라우저가 영상을 읽지 못하면 길이를 확인하지 못했다고 알린다", async () => {
  const pending = videoDuration(videoFile());
  const video = onlyVideo();
  const objectUrl = video.src;

  video.dispatchEvent(new window.Event("error"));

  await assert.rejects(pending, { message: "영상 길이를 확인하지 못했어요." });
  assert.equal(resolveObjectURL(objectUrl), undefined);
});

test("이미 취소된 요청은 영상을 열지 않고 취소 사유를 원인으로 남긴다", async () => {
  const controller = new AbortController();
  controller.abort("다른 영상 선택");

  const error = await videoDuration(videoFile(), controller.signal).catch((caught) => caught);

  assert.equal(createdVideos.length, 0);
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "영상 준비가 취소되었어요.");
  assert.equal(error.cause, "다른 영상 선택");
});

test("길이를 읽는 중 취소하면 영상 읽기를 멈추고 뒤늦은 메타데이터를 무시한다", async () => {
  const controller = new AbortController();
  const pending = videoDuration(videoFile(), controller.signal);
  const video = onlyVideo();
  const objectUrl = video.src;

  controller.abort("화면을 떠남");

  const error = await pending.catch((caught) => caught);
  assert.equal(error.name, "AbortError");
  assert.equal(error.cause, "화면을 떠남");
  assert.equal(video.hasAttribute("src"), false);
  assert.equal(video.onloadedmetadata, null);
  assert.equal(resolveObjectURL(objectUrl), undefined);
});

test("영상 요소를 준비하는 사이 취소되면 주소를 걸지 않고 취소로 끝낸다", async () => {
  const controller = new AbortController();
  onCreateVideo = () => controller.abort();

  const error = await videoDuration(videoFile(), controller.signal).catch((caught) => caught);

  assert.equal(error.name, "AbortError");
  assert.equal(onlyVideo().hasAttribute("src"), false);
});

test("길이를 읽은 직후 취소되면 길이 대신 취소로 끝낸다", async () => {
  const controller = new AbortController();
  const pending = videoDuration(videoFile(), controller.signal);
  const video = onlyVideo();
  const objectUrl = video.src;

  loadMetadata(video, 5);
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(resolveObjectURL(objectUrl), undefined);
});

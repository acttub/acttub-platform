import assert from "node:assert/strict";
import { File } from "node:buffer";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

const { defaultUploader } = await import("../src/lib/media/s3-uploader.ts");

// 브라우저 XMLHttpRequest 대역. 업로더가 건 처리기를 테스트가 브라우저 대신 부른다.
class FakeXhr {
  static instances = [];
  static failOn = null;

  upload = {};
  headers = {};
  status = 0;
  aborted = false;
  sent = false;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method, url) {
    if (FakeXhr.failOn === "open") throw new Error("bad url");
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    if (FakeXhr.failOn === "send") throw new Error("send blocked");
    this.sent = true;
    this.body = body;
  }

  abort() {
    if (FakeXhr.failOn === "abort") throw new Error("abort blocked");
    this.aborted = true;
    this.onabort?.();
  }

  respond(status) {
    this.status = status;
    this.onload();
  }
}

const originalXhr = globalThis.XMLHttpRequest;

beforeEach(() => {
  FakeXhr.instances = [];
  FakeXhr.failOn = null;
  globalThis.XMLHttpRequest = FakeXhr;
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXhr;
});

function videoFile(size = 10) {
  return new File([new Uint8Array(size)], "take.mp4", { type: "video/mp4" });
}

function onlyXhr() {
  assert.equal(FakeXhr.instances.length, 1);
  return FakeXhr.instances[0];
}

test("서명 주소로 Content-Type을 붙여 파일을 PUT하고 2xx면 100%로 끝낸다", async () => {
  const file = videoFile(10);
  const progress = [];
  const upload = defaultUploader({
    url: "https://s3.example/put?sig=1",
    file,
    contentType: "video/quicktime",
    onProgress: (value) => progress.push(value),
  });
  const xhr = onlyXhr();

  assert.equal(xhr.method, "PUT");
  assert.equal(xhr.url, "https://s3.example/put?sig=1");
  assert.deepEqual(xhr.headers, { "Content-Type": "video/quicktime" });
  assert.equal(xhr.body, file);

  xhr.upload.onprogress({ lengthComputable: true, loaded: 4, total: 10 });
  xhr.respond(204);

  assert.equal(await upload, undefined);
  assert.deepEqual(progress, [
    { loadedBytes: 4, totalBytes: 10, percent: 40 },
    { loadedBytes: 10, totalBytes: 10, percent: 100 },
  ]);
});

test("전체 크기를 모르는 진행은 파일 크기로 계산하고, 되돌아가거나 넘친 값은 막는다", async () => {
  const progress = [];
  const upload = defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(10),
    contentType: "video/mp4",
    onProgress: (value) => progress.push(value),
  });
  const xhr = onlyXhr();

  xhr.upload.onprogress({ lengthComputable: false, loaded: 3, total: 0 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 2, total: 0 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 15, total: 10 });
  xhr.respond(200);
  await upload;

  assert.deepEqual(progress, [
    { loadedBytes: 3, totalBytes: 10, percent: 30 },
    { loadedBytes: 3, totalBytes: 10, percent: 30 },
    { loadedBytes: 10, totalBytes: 10, percent: 100 },
  ]);
});

test("빈 파일의 진행은 0%로 알린다", async () => {
  const progress = [];
  const upload = defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(0),
    contentType: "video/mp4",
    onProgress: (value) => progress.push(value),
  });
  const xhr = onlyXhr();

  xhr.upload.onprogress({ lengthComputable: false, loaded: 0, total: 0 });
  xhr.respond(200);
  await upload;

  assert.deepEqual(progress, [{ loadedBytes: 0, totalBytes: 0, percent: 0 }]);
});

test("진행 콜백이 없어도 진행 이벤트를 받으며 업로드를 마친다", async () => {
  const file = videoFile(10);
  const upload = defaultUploader({ url: "https://s3.example/put", file, contentType: "video/mp4" });
  const xhr = onlyXhr();

  xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
  xhr.respond(200);

  assert.equal(await upload, undefined);
  assert.equal(xhr.body, file);
});

test("403은 서명 만료로, 그 밖의 실패 상태는 HTTP 코드와 함께 알린다", async () => {
  for (const [status, message] of [
    [403, "업로드 URL이 만료되었을 수 있어요. 업로드를 처음부터 다시 시도해 주세요."],
    [500, "영상 업로드에 실패했어요. (HTTP 500)"],
    [300, "영상 업로드에 실패했어요. (HTTP 300)"],
  ]) {
    FakeXhr.instances = [];
    const upload = defaultUploader({ url: "https://s3.example/put", file: videoFile(), contentType: "video/mp4" });
    onlyXhr().respond(status);

    await assert.rejects(upload, { name: "S3PutError", message });
  }
});

test("네트워크 오류는 네트워크 문제로 알린다", async () => {
  const upload = defaultUploader({ url: "https://s3.example/put", file: videoFile(), contentType: "video/mp4" });
  onlyXhr().onerror();

  await assert.rejects(upload, { name: "S3PutError", message: "네트워크 문제로 영상을 업로드하지 못했어요." });
});

test("이미 취소된 요청은 보내지 않고 취소 사유를 원인으로 남긴다", async () => {
  const controller = new AbortController();
  controller.abort();

  const error = await defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(),
    contentType: "video/mp4",
    signal: controller.signal,
  }).catch((caught) => caught);

  assert.equal(FakeXhr.instances.length, 0);
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "This operation was aborted");
  assert.equal(error.cause, controller.signal.reason);
});

test("취소 사유가 AbortError가 아니면 업로드 취소 문구로 바꿔 알린다", async () => {
  const controller = new AbortController();
  controller.abort("화면을 떠남");

  const error = await defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(),
    contentType: "video/mp4",
    signal: controller.signal,
  }).catch((caught) => caught);

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "업로드가 취소되었어요.");
  assert.equal(error.cause.name, "AbortError");
});

test("올리는 중 취소하면 요청을 끊고 AbortError로 끝낸다", async () => {
  const controller = new AbortController();
  const upload = defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(),
    contentType: "video/mp4",
    signal: controller.signal,
  });
  const xhr = onlyXhr();

  controller.abort();

  assert.equal(xhr.aborted, true);
  await assert.rejects(upload, { name: "AbortError", message: "This operation was aborted" });
});

test("요청을 끊지 못하면 취소 실패로 알리고, 뒤늦게 업로드가 끝나도 실패로 남긴다", async () => {
  const controller = new AbortController();
  const upload = defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(),
    contentType: "video/mp4",
    signal: controller.signal,
  });
  FakeXhr.failOn = "abort";

  controller.abort();
  onlyXhr().respond(200);

  const error = await upload.catch((caught) => caught);
  assert.equal(error.name, "S3PutError");
  assert.equal(error.message, "업로드를 취소하지 못했어요.");
  assert.equal(error.cause.message, "abort blocked");
});

test("요청을 열지 못하면 보내지 않고 준비 실패로 알린다", async () => {
  FakeXhr.failOn = "open";

  const error = await defaultUploader({ url: "not a url", file: videoFile(), contentType: "video/mp4" }).catch(
    (caught) => caught,
  );

  assert.equal(onlyXhr().sent, false);
  assert.equal(error.name, "S3PutError");
  assert.equal(error.message, "S3 업로드 요청을 준비하지 못했어요.");
  assert.equal(error.cause.message, "bad url");
});

test("보내기가 바로 실패하면 업로드 실패로 알린다", async () => {
  FakeXhr.failOn = "send";

  const error = await defaultUploader({ url: "https://s3.example/put", file: videoFile(), contentType: "video/mp4" }).catch(
    (caught) => caught,
  );

  assert.equal(error.name, "S3PutError");
  assert.equal(error.message, "영상을 업로드하지 못했어요.");
  assert.equal(error.cause.message, "send blocked");
});

test("XMLHttpRequest가 없는 환경에서는 업로드할 수 없다고 알린다", async () => {
  delete globalThis.XMLHttpRequest;

  await assert.rejects(defaultUploader({ url: "https://s3.example/put", file: videoFile(), contentType: "video/mp4" }), {
    name: "S3PutError",
    message: "현재 환경에서는 브라우저 S3 업로드를 사용할 수 없어요.",
  });
});

test("끝난 업로드는 뒤늦은 취소·오류에 요청을 끊거나 결과를 바꾸지 않는다", async () => {
  const controller = new AbortController();
  const upload = defaultUploader({
    url: "https://s3.example/put",
    file: videoFile(),
    contentType: "video/mp4",
    signal: controller.signal,
  });
  const xhr = onlyXhr();

  xhr.respond(200);
  xhr.onerror();
  controller.abort();

  assert.equal(await upload, undefined);
  assert.equal(xhr.aborted, false);
});

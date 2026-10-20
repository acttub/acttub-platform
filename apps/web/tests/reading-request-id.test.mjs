// reading.script — 기기가 만드는 요청 id. HTTP 로 연 LAN 배포처럼 crypto.randomUUID 가 없는 곳에서는 getRandomValues 로
// UUID v4 를 만든다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

const { newRequestId } = await import("../src/lib/reading/request-id.ts");

afterEach(() => {
  delete globalThis.crypto.randomUUID;
  delete globalThis.crypto.getRandomValues;
});

test("reading.script: randomUUID 가 있으면 그 값을 그대로 쓴다", () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => "11111111-2222-4333-8444-555555555555" });
  assert.equal(newRequestId(), "11111111-2222-4333-8444-555555555555");
});

test("reading.script: randomUUID 가 없으면 무작위 16바이트에 버전 4·변형 비트를 넣어 UUID 모양으로 쓴다", () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    configurable: true,
    value: (bytes) => {
      bytes.fill(0xff);
      return bytes;
    },
  });
  assert.equal(newRequestId(), "ffffffff-ffff-4fff-bfff-ffffffffffff");
});

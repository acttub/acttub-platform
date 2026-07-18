import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { sanitizeNextPath } = await import("../src/lib/auth/next-path.ts");

test("허용한 내부 경로와 query, hash를 보존한다", () => {
  assert.equal(sanitizeNextPath("/home"), "/home");
  assert.equal(
    sanitizeNextPath("/practice/new?from=login#context"),
    "/practice/new?from=login#context",
  );
  assert.equal(
    sanitizeNextPath("/practice/history/session-1"),
    "/practice/history/session-1",
  );
});

test("외부 origin과 scheme-relative 경로를 기본 경로로 바꾼다", () => {
  assert.equal(sanitizeNextPath("https://evil.example/home"), "/home");
  assert.equal(sanitizeNextPath("//evil.example/home"), "/home");
});

test("인코딩한 slash와 backslash를 거부한다", () => {
  assert.equal(sanitizeNextPath("/home/path%2Ftail"), "/home");
  assert.equal(sanitizeNextPath("/practice/new/foo%5Cbar"), "/home");
  assert.equal(sanitizeNextPath("/home\\admin"), "/home");
  assert.equal(sanitizeNextPath("/home/line\nbreak"), "/home");
});

test("allowlist prefix를 가장한 경로를 거부한다", () => {
  assert.equal(sanitizeNextPath("/homepage"), "/home");
  assert.equal(sanitizeNextPath("/practice/newish"), "/home");
  assert.equal(sanitizeNextPath(null), "/home");
});

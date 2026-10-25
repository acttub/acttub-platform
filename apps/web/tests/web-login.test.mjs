// 웹 회원 로그인(SOMA-834): 그릴 제공자, 돌아갈 곳, 회원 표시가 토큰과 같이 지워지는지.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { webProviders, safeNext } = await import("../src/features/auth/login-providers.ts");
const { clearTokens, isMemberSession, memberProvider, setTokens } = await import("../src/lib/auth/token-store.ts");

test("서버 순서를 지키고 웹 설정이 있는 제공자만 남긴다", () => {
  const server = ["apple", "google", "kakao", "naver"];
  assert.deepEqual(webProviders(server, { google: "g", naver: "n" }), ["google", "naver"]);
  assert.deepEqual(webProviders(server, { google: "g", naver: "" }), ["google"]);
  assert.deepEqual(webProviders(["naver", "google"], { google: "g", naver: "n" }), ["naver", "google"]);
  assert.deepEqual(webProviders([], { google: "g", naver: "n" }), []);
});

test("돌아갈 곳은 같은 사이트 경로만 받는다", () => {
  assert.equal(safeNext("/account"), "/account");
  assert.equal(safeNext("/reading?x=1"), "/reading?x=1");
  assert.equal(safeNext("//evil.example"), "/account");
  assert.equal(safeNext("https://evil.example"), "/account");
  assert.equal(safeNext(null), "/account");
});

test("게스트 토큰은 회원이 아니고, 회원 표시는 토큰을 지우면 같이 사라진다", () => {
  clearTokens();
  setTokens({ access_token: "guest-a", refresh_token: "guest-r" });
  assert.equal(isMemberSession(), false);
  clearTokens();
  assert.equal(memberProvider(), null);
});

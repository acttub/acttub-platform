// /auth/naver/callback: 앱의 네이버 로그인(PKCE)이 거쳐 가는 Callback URL. 네이버가 준 code·state·error 를
// 그대로 앱 스킴으로 넘기고, 자동 이동이 막혀도 같은 주소의 링크가 남는다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { naverAppReturnUrl } = await import("../src/lib/auth/naver-app-return.ts");
const { default: NaverAppReturn } = await import("../src/app/auth/naver/callback/naver-app-return.tsx");
const callbackPage = await import("../src/app/auth/naver/callback/page.tsx");

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

test("네이버가 준 code·state 를 앱 주소로 그대로 넘긴다", () => {
  assert.equal(
    naverAppReturnUrl("?code=Ab%2Bc%2F9&state=s_-1"),
    "actingapp://auth/naver?code=Ab%2Bc%2F9&state=s_-1",
  );
});

test("동의 취소 같은 오류도 state 와 함께 넘기고, 모르는 값은 버린다", () => {
  assert.equal(
    naverAppReturnUrl("?state=s1&error=access_denied&error_description=Canceled+By+User&utm_source=x"),
    "actingapp://auth/naver?state=s1&error=access_denied&error_description=Canceled+By+User",
  );
  assert.equal(naverAppReturnUrl(""), "actingapp://auth/naver");
});

test("페이지는 열리자마자 앱 주소로 이동하고 같은 주소의 링크를 남긴다", async () => {
  window.history.replaceState(null, "", "/auth/naver/callback?code=c1&state=s1");
  const moved = [];
  render(react.createElement(NaverAppReturn, { navigate: (href) => moved.push(href) }));

  await waitFor(() => assert.deepEqual(moved, ["actingapp://auth/naver?code=c1&state=s1"]));
  assert.equal(screen.getByText("앱으로 돌아가는 중이에요.").textContent, "앱으로 돌아가는 중이에요.");
  assert.equal(
    screen.getByRole("link", { name: "앱으로 돌아가기" }).getAttribute("href"),
    "actingapp://auth/naver?code=c1&state=s1",
  );
});

test("검색엔진에 싣지 않는다", () => {
  assert.equal(callbackPage.metadata.title, "네이버 로그인");
  assert.deepEqual(callbackPage.metadata.robots, { index: false, follow: false });
});


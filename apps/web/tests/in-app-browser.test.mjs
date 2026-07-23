import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { detectInAppBrowser, externalBrowserUrl, inAppBrowserNotice } =
  await import("../src/lib/auth/in-app-browser.ts");

const KAKAO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.6.0";
const LINE_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-S901N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/13.5.0/IAB";
const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.23.111";
const NAVER_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)";
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-S901N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

test("인앱 브라우저 UA를 종류별로 감지한다", () => {
  assert.equal(detectInAppBrowser(KAKAO_UA), "kakaotalk");
  assert.equal(detectInAppBrowser(LINE_UA), "line");
  assert.equal(detectInAppBrowser(INSTAGRAM_UA), "generic");
  assert.equal(detectInAppBrowser(NAVER_UA), "generic");
  assert.equal(detectInAppBrowser(ANDROID_WEBVIEW_UA), "generic");
});

test("일반 브라우저 UA는 감지하지 않는다", () => {
  assert.equal(detectInAppBrowser(CHROME_DESKTOP_UA), null);
  assert.equal(detectInAppBrowser(SAFARI_IOS_UA), null);
  assert.equal(detectInAppBrowser(CHROME_ANDROID_UA), null);
});

test("카카오톡은 openExternal 스킴으로 현재 URL을 인코딩해 넘긴다", () => {
  const url = externalBrowserUrl(
    "kakaotalk",
    "https://acttub.com/login?next=%2Fhome",
  );
  assert.equal(
    url,
    "kakaotalk://web/openExternal?url=https%3A%2F%2Facttub.com%2Flogin%3Fnext%3D%252Fhome",
  );
});

test("LINE은 기존 query를 보존하며 openExternalBrowser=1을 붙인다", () => {
  const url = externalBrowserUrl("line", "https://acttub.com/login?next=%2Fhome");
  assert.equal(
    url,
    "https://acttub.com/login?next=%2Fhome&openExternalBrowser=1",
  );
});

test("LINE 탈출 파라미터가 이미 붙어 있으면 재이동하지 않는다 (루프 방지)", () => {
  assert.equal(
    externalBrowserUrl(
      "line",
      "https://acttub.com/login?openExternalBrowser=1",
    ),
    null,
  );
});

test("탈출 수단이 없는 인앱 브라우저는 이동 URL이 없다", () => {
  assert.equal(externalBrowserUrl("generic", "https://acttub.com/login"), null);
});

test("안내 문구는 브라우저 종류별로 제공된다", () => {
  for (const browser of ["kakaotalk", "line", "generic"]) {
    const notice = inAppBrowserNotice(browser);
    assert.equal(typeof notice, "string");
    assert.ok(notice.includes("기본 브라우저"));
  }
});

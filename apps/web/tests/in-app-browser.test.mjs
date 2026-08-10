import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  detectInAppBrowser,
  externalBrowserUrl,
  googleLoginNotices,
  inAppBrowserNotice,
} = await import("../src/lib/auth/in-app-browser.ts");

const KAKAO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.6.0";
const LINE_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-S901N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/13.5.0/IAB";
const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.23.111";
const ANDROID_INSTAGRAM_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.0.70 Android";
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

test("안내 문구는 자동 탈출 수단이 있는 브라우저에만 있다", () => {
  for (const browser of ["kakaotalk", "line"]) {
    const notice = inAppBrowserNotice(browser);
    assert.equal(typeof notice, "string");
    assert.ok(notice.includes("기본 브라우저"));
  }
});

test("아이폰 Instagram에는 어떤 안내도 표시하지 않는다", () => {
  const browser = detectInAppBrowser(INSTAGRAM_UA);

  assert.equal(browser, "generic");
  assert.deepEqual(googleLoginNotices(browser, false), {
    inAppBrowser: null,
    loadError: null,
  });
});

test("Android Instagram WebView는 GIS 로드가 실패해도 안내를 표시하지 않는다", () => {
  const browser = detectInAppBrowser(ANDROID_INSTAGRAM_WEBVIEW_UA);

  assert.equal(browser, "generic");
  assert.deepEqual(googleLoginNotices(browser, true), {
    inAppBrowser: null,
    loadError: null,
  });
});

test("generic 인앱 안내 문구는 코드에 남아 있지 않다", async () => {
  const source = await readFile(
    new URL("../src/lib/auth/in-app-browser.ts", import.meta.url),
    "utf8",
  );

  assert.ok(!source.includes("새로고침해도 안 되면"));
  assert.ok(!source.includes("앱 안 브라우저에서는"));
});

test("일반 브라우저에서 GIS 로드가 실패하면 기존 일반 오류를 표시한다", () => {
  const browser = detectInAppBrowser(CHROME_DESKTOP_UA);

  assert.equal(browser, null);
  assert.deepEqual(googleLoginNotices(browser, true), {
    inAppBrowser: null,
    loadError:
      "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요",
  });
});

test("카카오톡은 GIS 로드 결과를 기다리지 않고 UA 시점에 안내를 표시한다", () => {
  const browser = detectInAppBrowser(KAKAO_UA);

  assert.equal(browser, "kakaotalk");
  assert.deepEqual(googleLoginNotices(browser, false), {
    inAppBrowser: inAppBrowserNotice("kakaotalk"),
    loadError: null,
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  APP_STORE_URL,
  GOOGLE_PLAY_URL,
  STORE_ORDER,
  detectMobileOs,
  downloadHrefFor,
  storeHref,
} = await import("../src/lib/app-download/store-links.ts");

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
// 2026-08-14 실측 UA. 크롬은 기기명을 지운 축약 UA 를 보낸다("Android 10; K" 는 실제
// 안드로이드 16 기기도 그렇게 말한다), 사파리는 iOS 26.5 를 Version/ 에만 적는다.
const ANDROID_REDUCED_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";
const IPHONE_IOS26_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("스토어 주소는 스토어가 요구하는 열쇠를 그대로 담는다", () => {
  assert.equal(APP_STORE_URL, "https://apps.apple.com/kr/app/acttub/id6793056855");
  assert.equal(
    GOOGLE_PLAY_URL,
    "https://play.google.com/store/apps/details?id=com.acttub.app",
  );
});

test("Play 주소의 패키지명은 앱이 실제로 올라간 패키지명과 같다", () => {
  const appJson = JSON.parse(
    readFileSync(path.join(repoRoot, "apps", "mobile", "app.json"), "utf8"),
  );

  assert.equal(
    new URL(GOOGLE_PLAY_URL).searchParams.get("id"),
    appJson.expo.android.package,
  );
});

test("App Store 주소의 앱 id는 제출 설정의 ascAppId와 같다", () => {
  const easJson = JSON.parse(
    readFileSync(path.join(repoRoot, "apps", "mobile", "eas.json"), "utf8"),
  );

  assert.match(APP_STORE_URL, /\/id(\d+)$/);
  assert.equal(
    APP_STORE_URL.match(/\/id(\d+)$/)[1],
    easJson.submit.production.ios.ascAppId,
  );
});

test("Play 주소에는 화면별 utm이 referrer로 붙고 App Store 주소는 그대로다", () => {
  assert.equal(storeHref("app_store", "landing_hero"), APP_STORE_URL);

  const playUrl = new URL(storeHref("google_play", "landing_footer"));

  assert.equal(playUrl.searchParams.get("id"), "com.acttub.app");
  assert.equal(
    playUrl.searchParams.get("referrer"),
    "utm_source=acttub_web&utm_medium=landing_footer",
  );
});

test("배지 순서는 두 스토어를 한 번씩만 담는다", () => {
  assert.deepEqual([...STORE_ORDER].sort(), ["app_store", "google_play"]);
});

test("기기 판별은 아이폰·안드로이드를 가리고 데스크톱은 못 가린다고 말한다", () => {
  assert.equal(detectMobileOs(IPHONE_UA), "ios");
  assert.equal(detectMobileOs(ANDROID_UA), "android");
  assert.equal(detectMobileOs(MAC_UA), null);
  assert.equal(detectMobileOs(""), null);
});

// 시뮬레이터·에뮬레이터에서 실제로 받아 온 UA (2026-08-14).
test("실측 UA — iOS 26.5 사파리와 안드로이드 크롬 축약 UA 를 가린다", () => {
  assert.equal(detectMobileOs(IPHONE_IOS26_UA, 5), "ios");
  assert.equal(detectMobileOs(ANDROID_REDUCED_UA, 5), "android");
});

// 안드로이드 크롬 UA 에도 Safari 가 들어 있어 순서를 뒤집으면 iOS 로 새어 나간다.
test("안드로이드 UA 는 Safari 가 섞여 있어도 안드로이드로 간다", () => {
  assert.match(ANDROID_UA, /Safari/);
  assert.equal(detectMobileOs(ANDROID_UA), "android");
});

// iPadOS 13+ 는 자기를 Macintosh 라고 말한다 — 터치 포인트 수가 유일한 단서다.
test("아이패드는 Macintosh 로 위장해도 터치 포인트로 잡는다", () => {
  assert.equal(detectMobileOs(MAC_UA, 5), "ios");
  assert.equal(detectMobileOs(MAC_UA, 0), null);
});

test("다운로드 버튼 주소는 기기에 맞는 스토어로, 못 가리면 /app 으로 간다", () => {
  assert.equal(downloadHrefFor("ios", "landing_hero"), APP_STORE_URL);
  assert.equal(
    downloadHrefFor("android", "landing_hero"),
    storeHref("google_play", "landing_hero"),
  );
  assert.equal(downloadHrefFor(null, "landing_hero"), "/app");
});

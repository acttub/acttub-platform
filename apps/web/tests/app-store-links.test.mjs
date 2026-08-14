import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  APP_STORE_URL,
  GOOGLE_PLAY_URL,
  STORE_ORDER,
  storeHref,
} = await import("../src/lib/app-download/store-links.ts");

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

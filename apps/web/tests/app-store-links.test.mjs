import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import "./ts-module-loader.mjs";

const {
  APP_DOWNLOAD_ATTR,
  APP_STORE_URL,
  GOOGLE_PLAY_URL,
  STORE_ORDER,
  buildAppDownloadBootstrapScript,
  detectMobileOs,
  downloadHrefFor,
  goHref,
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

  const stickyPlayUrl = new URL(storeHref("google_play", "landing_sticky"));
  assert.equal(
    stickyPlayUrl.searchParams.get("referrer"),
    "utm_source=acttub_web&utm_medium=landing_sticky",
  );
});

test("go 주소는 스토어와 화면의 8개 조합을 내부 경로로 바꾼다", () => {
  const surfaces = [
    "landing_hero",
    "landing_app_section",
    "landing_footer",
    "app_page",
  ];

  assert.deepEqual(
    surfaces.flatMap((surface) => [
      goHref("app_store", surface),
      goHref("google_play", surface),
    ]),
    [
      "/go/ios/landing_hero",
      "/go/android/landing_hero",
      "/go/ios/landing_app_section",
      "/go/android/landing_app_section",
      "/go/ios/landing_footer",
      "/go/android/landing_footer",
      "/go/ios/app_page",
      "/go/android/app_page",
    ],
  );
});

// 배지 컴포넌트는 next/image 를 물고 있어 이 로더로는 import 하지 못한다.
// 소스를 읽어 배선만 확인한다 — 주소 규칙 자체는 위 goHref 테스트가 지킨다.
test("스토어 배지는 최종 스토어 주소 대신 go 주소를 쓴다", () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../src/features/app-download/store-badges.tsx",
    ),
    "utf8",
  );

  assert.ok(source.includes("goHref(store, surface)"));
  assert.ok(!source.includes("storeHref("));
});

test("go 주소는 스토어와 화면의 8개 조합을 내부 경로로 바꾼다", () => {
  const surfaces = [
    "landing_hero",
    "landing_app_section",
    "landing_footer",
    "app_page",
  ];

  assert.deepEqual(
    surfaces.flatMap((surface) => [
      goHref("app_store", surface),
      goHref("google_play", surface),
    ]),
    [
      "/go/ios/landing_hero",
      "/go/android/landing_hero",
      "/go/ios/landing_app_section",
      "/go/android/landing_app_section",
      "/go/ios/landing_footer",
      "/go/android/landing_footer",
      "/go/ios/app_page",
      "/go/android/app_page",
    ],
  );
});

// 배지 컴포넌트는 next/image 를 물고 있어 이 로더로는 import 하지 못한다.
// 소스를 읽어 배선만 확인한다 — 주소 규칙 자체는 위 goHref 테스트가 지킨다.
test("스토어 배지는 최종 스토어 주소 대신 go 주소를 쓴다", () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../src/features/app-download/store-badges.tsx",
    ),
    "utf8",
  );

  assert.ok(source.includes("goHref(store, surface)"));
  assert.ok(!source.includes("storeHref("));
});

// 하이드레이션 전에 도는 인라인 스크립트를 가짜 DOM 에서 실제로 돌려 본다.
// 스크립트는 손으로 쓴 JS 문자열이라 `downloadHrefFor` 와 갈라질 수 있다 — 여기서 묶어 둔다.
function runBootstrap(userAgent, maxTouchPoints, surface = "landing_hero") {
  const element = {
    nodeType: 1,
    parentNode: null,
    attributes: { [APP_DOWNLOAD_ATTR]: surface, href: "/app" },
    hasAttribute(name) {
      return name in this.attributes;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const listeners = [];
  const location = { href: "(이동안함)" };
  const sandbox = {
    navigator: { userAgent, maxTouchPoints },
    location,
    document: {
      readyState: "complete",
      querySelectorAll: (selector) =>
        selector === `a[${APP_DOWNLOAD_ATTR}]` ? [element] : [],
      addEventListener(type, handler, capture) {
        listeners.push({ type, handler, capture });
      },
    },
    encodeURIComponent,
  };
  runInNewContext(buildAppDownloadBootstrapScript(), sandbox);

  const click = listeners.find((l) => l.type === "click");
  const clickOnButton = () => {
    let prevented = false;
    click?.handler({ target: element, preventDefault: () => (prevented = true) });
    return { prevented, movedTo: location.href };
  };

  return { patchedHref: element.attributes.href, click, clickOnButton };
}

test("인라인 스크립트는 하이드레이션 전에 downloadHrefFor 와 같은 주소를 넣는다", () => {
  for (const [userAgent, touch] of [
    [IPHONE_IOS26_UA, 5],
    [ANDROID_REDUCED_UA, 5],
    [IPHONE_UA, 5],
    [ANDROID_UA, 5],
    [MAC_UA, 0],
    [MAC_UA, 5],
  ]) {
    const expected = downloadHrefFor(
      detectMobileOs(userAgent, touch),
      "landing_hero",
    );
    assert.equal(runBootstrap(userAgent, touch).patchedHref, expected, userAgent);
  }
});

test("인라인 스크립트는 화면마다 다른 utm 을 그대로 싣는다", () => {
  assert.equal(
    runBootstrap(ANDROID_REDUCED_UA, 5, "landing_footer").patchedHref,
    downloadHrefFor("android", "landing_footer"),
  );
});

// 주소를 고칠 틈조차 없었던 경우를 막는 본체. 리스너는 capture 로 달려야
// React 보다 먼저 잡는다.
test("클릭 가로채기는 capture 로 걸리고 기기에 맞는 스토어로 보낸다", () => {
  const android = runBootstrap(ANDROID_REDUCED_UA, 5);
  assert.equal(android.click?.capture, true);
  assert.deepEqual(android.clickOnButton(), {
    prevented: true,
    movedTo: downloadHrefFor("android", "landing_hero"),
  });

  const ios = runBootstrap(IPHONE_IOS26_UA, 5);
  assert.deepEqual(ios.clickOnButton(), {
    prevented: true,
    movedTo: APP_STORE_URL,
  });
});

test("데스크톱에서는 가로채지 않고 /app 링크를 그대로 둔다", () => {
  const desktop = runBootstrap(MAC_UA, 0);
  assert.equal(desktop.patchedHref, "/app");
  assert.deepEqual(desktop.clickOnButton(), {
    prevented: false,
    movedTo: "(이동안함)",
  });
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

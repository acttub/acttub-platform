import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import "./ts-module-loader.mjs";

const {
  APP_DOWNLOAD_ATTR,
  APP_DOWNLOAD_FINAL_STORE_ATTR,
  APP_DOWNLOAD_STORE_ATTR,
  APP_STORE_URL,
  GOOGLE_PLAY_URL,
  STORE_CAMPAIGN_PARAMS,
  STORE_CAMPAIGN_VALUE_MAX_LENGTH,
  STORE_LINK_SURFACES,
  STORE_ORDER,
  buildAppDownloadBootstrapScript,
  detectMobileOs,
  downloadHrefFor,
  goHref,
  playInstallReferrer,
  storeCampaignQuery,
  storeHref,
} = await import("../src/lib/app-download/store-links.ts");

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_REDUCED_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";
const IPHONE_IOS26_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PAID_SEARCH =
  "?utm_source=instagram&utm_medium=paid_social&utm_campaign=app_launch&utm_id=meta_42&utm_term=acting&utm_content=reel_a&fbclid=click-identifier&session=private";
const PAID_QUERY =
  "?utm_source=instagram&utm_medium=paid_social&utm_campaign=app_launch&utm_id=meta_42&utm_term=acting&utm_content=reel_a";
const PAID_REFERRER = PAID_QUERY.slice(1);

function playReferrer(href) {
  return new URL(href).searchParams.get("referrer");
}

test("스토어 주소는 스토어가 요구하는 열쇠를 그대로 담는다", () => {
  assert.equal(APP_STORE_URL, "https://apps.apple.com/kr/app/acttub/id6793056855");
  assert.equal(
    GOOGLE_PLAY_URL,
    "https://play.google.com/store/apps/details?id=com.acttub.app",
  );
});

test("스토어 주소의 앱 식별자는 모바일 제출 설정과 같다", () => {
  const appJson = JSON.parse(
    readFileSync(path.join(repoRoot, "apps", "mobile", "app.json"), "utf8"),
  );
  const easJson = JSON.parse(
    readFileSync(path.join(repoRoot, "apps", "mobile", "eas.json"), "utf8"),
  );

  assert.equal(
    new URL(GOOGLE_PLAY_URL).searchParams.get("id"),
    appJson.expo.android.package,
  );
  assert.equal(
    APP_STORE_URL.match(/\/id(\d+)$/)[1],
    easJson.submit.production.ios.ascAppId,
  );
});

test("UTM이 없으면 기존 acttub_web과 원래 surface를 유지한다", () => {
  assert.equal(
    playInstallReferrer("landing_footer"),
    "utm_source=acttub_web&utm_medium=landing_footer",
  );
  assert.equal(
    playReferrer(storeHref("google_play", "landing_sticky")),
    "utm_source=acttub_web&utm_medium=landing_sticky",
  );
});

test("현재 URL의 안전한 UTM 6종만 Google Play Install Referrer로 보존한다", () => {
  assert.deepEqual([...STORE_CAMPAIGN_PARAMS], [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_id",
    "utm_term",
    "utm_content",
  ]);
  assert.equal(storeCampaignQuery(PAID_SEARCH), PAID_QUERY);
  assert.equal(
    playReferrer(storeHref("google_play", "app_page", PAID_SEARCH)),
    PAID_REFERRER,
  );
});

test("최대 길이의 UTM 여섯 개도 Install Referrer 512자 안에 남는다", () => {
  const value = "a".repeat(STORE_CAMPAIGN_VALUE_MAX_LENGTH);
  const search = `?${STORE_CAMPAIGN_PARAMS.map((key) => `${key}=${value}`).join("&")}`;

  assert.ok(playInstallReferrer("landing_hero", search).length <= 512);
});

test("클릭 식별자, 임의 쿼리, 위험 문자, 빈 값, 너무 긴 값은 전달하지 않는다", () => {
  const tooLong = "a".repeat(STORE_CAMPAIGN_VALUE_MAX_LENGTH + 1);
  const search =
    `?utm_source=%3Cscript%3E&utm_source=instagram` +
    `&utm_medium=paid%20social&utm_medium=paid_social` +
    `&utm_campaign=${tooLong}&utm_id=id%26session%3Dprivate` +
    "&utm_term=&utm_content=reel-7&fbclid=IwAR0abc&gclid=google-click" +
    "&email=actor%40example.com&session=private";

  assert.equal(
    storeCampaignQuery(search),
    "?utm_source=instagram&utm_medium=paid_social&utm_content=reel-7",
  );
  assert.equal(
    playInstallReferrer("landing_hero", search),
    "utm_source=instagram&utm_medium=paid_social&utm_content=reel-7",
  );
});

test("인스타그램 source만으로 paid를 추정하지 않고 paid_social이 명시된 때만 보존한다", () => {
  assert.equal(
    playInstallReferrer("app_page", "?utm_source=instagram"),
    "utm_source=instagram&utm_medium=app_page",
  );
  assert.equal(
    playInstallReferrer(
      "app_page",
      "?utm_source=instagram&utm_medium=paid_social",
    ),
    "utm_source=instagram&utm_medium=paid_social",
  );
});

test("App Store 주소는 UTM이 있어도 그대로이며 ct와 pt를 만들지 않는다", () => {
  const href = storeHref("app_store", "app_page", PAID_SEARCH);
  assert.equal(href, APP_STORE_URL);
  assert.equal(new URL(href).searchParams.get("ct"), null);
  assert.equal(new URL(href).searchParams.get("pt"), null);
});

test("허용 UTM은 /app과 /go 경유에서도 보존되고 금지 쿼리는 제거된다", () => {
  assert.equal(downloadHrefFor(null, "landing_hero", PAID_SEARCH), `/app${PAID_QUERY}`);
  assert.equal(
    goHref("google_play", "app_page", PAID_SEARCH),
    `/go/android/app_page${PAID_QUERY}`,
  );
  assert.equal(
    goHref("app_store", "app_page", PAID_SEARCH),
    `/go/ios/app_page${PAID_QUERY}`,
  );
});

test("모든 다운로드 surface가 /go 정적 경로 목록의 단일 정본에 있다", () => {
  assert.deepEqual([...STORE_LINK_SURFACES], [
    "landing_header",
    "landing_hero",
    "landing_app_section",
    "landing_sticky",
    "landing_cta",
    "landing_footer",
    "app_page",
    "keyword_page",
    "entry_share",
  ]);
});

test("스토어 배지와 /app, /go 페이지는 bootstrap과 캠페인 훅을 연결한다", () => {
  const badges = readFileSync(
    path.resolve(import.meta.dirname, "../src/features/app-download/store-badges.tsx"),
    "utf8",
  );
  const appPage = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/app/page.tsx"),
    "utf8",
  );
  const goPage = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/go/[os]/[surface]/page.tsx"),
    "utf8",
  );
  const redirect = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../src/app/go/[os]/[surface]/store-redirect.tsx",
    ),
    "utf8",
  );
  const workspace = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../src/features/workspace/workspace-app.tsx",
    ),
    "utf8",
  );

  assert.match(badges, /goHref\(store, surface, search\)/);
  assert.match(badges, /APP_DOWNLOAD_STORE_ATTR/);
  assert.match(badges, /buildAppDownloadBootstrapScript\(\)/);
  assert.match(appPage, /buildAppDownloadBootstrapScript\(\)/);
  assert.match(goPage, /buildAppDownloadBootstrapScript\(\)/);
  assert.match(goPage, /STORE_LINK_SURFACES/);
  assert.match(redirect, /storeHref\(store, surface, search\)/);
  assert.match(redirect, /APP_DOWNLOAD_FINAL_STORE_ATTR/);
  assert.equal(
    workspace.match(/\[APP_DOWNLOAD_ATTR\]: "app_page"/g)?.length,
    2,
    "홈 워크스페이스의 데스크톱·모바일 앱 링크가 현재 UTM을 보존해야 한다",
  );
});

function runBootstrap({
  userAgent,
  maxTouchPoints,
  surface = "landing_hero",
  search = "",
  store = null,
  finalStore = null,
  target = null,
  download = false,
}) {
  const attributes = { [APP_DOWNLOAD_ATTR]: surface, href: "/app" };
  if (store) attributes[APP_DOWNLOAD_STORE_ATTR] = store;
  if (finalStore) attributes[APP_DOWNLOAD_FINAL_STORE_ATTR] = finalStore;
  if (target) attributes.target = target;
  if (download) attributes.download = "";

  const element = {
    nodeType: 1,
    parentNode: null,
    attributes,
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
  const location = { href: "(이동안함)", search };
  const failOnStorage = new Proxy(
    {},
    {
      get() {
        throw new Error("다운로드 bootstrap이 브라우저 저장소를 읽음");
      },
      set() {
        throw new Error("다운로드 bootstrap이 브라우저 저장소를 씀");
      },
    },
  );
  const document = {
    readyState: "complete",
    querySelectorAll: (selector) =>
      selector === `a[${APP_DOWNLOAD_ATTR}]` ? [element] : [],
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
  };
  Object.defineProperty(document, "cookie", {
    get() {
      throw new Error("다운로드 bootstrap이 cookie를 읽음");
    },
    set() {
      throw new Error("다운로드 bootstrap이 cookie를 씀");
    },
  });

  runInNewContext(buildAppDownloadBootstrapScript(), {
    window: {},
    navigator: { userAgent, maxTouchPoints },
    location,
    document,
    encodeURIComponent,
    URLSearchParams,
    localStorage: failOnStorage,
    sessionStorage: failOnStorage,
  });

  const click = listeners.find((listener) => listener.type === "click");
  const clickOnButton = (event = {}) => {
    let prevented = false;
    click?.handler({
      ...event,
      target: element,
      preventDefault: () => (prevented = true),
    });
    return {
      prevented,
      movedTo: location.href,
      href: element.attributes.href,
    };
  };

  return { patchedHref: element.attributes.href, click, clickOnButton };
}

test("bootstrap 자동 버튼은 React 순수 함수와 같은 안전한 주소를 만든다", () => {
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
      PAID_SEARCH,
    );
    assert.equal(
      runBootstrap({ userAgent, maxTouchPoints: touch, search: PAID_SEARCH })
        .patchedHref,
      expected,
      userAgent,
    );
  }
});

test("bootstrap은 배지의 /go와 /go 최종 링크에서도 같은 UTM 규칙을 쓴다", () => {
  assert.equal(
    runBootstrap({
      userAgent: ANDROID_UA,
      maxTouchPoints: 5,
      surface: "app_page",
      search: PAID_SEARCH,
      store: "google_play",
    }).patchedHref,
    goHref("google_play", "app_page", PAID_SEARCH),
  );
  assert.equal(
    runBootstrap({
      userAgent: ANDROID_UA,
      maxTouchPoints: 5,
      surface: "app_page",
      search: PAID_SEARCH,
      finalStore: "google_play",
    }).patchedHref,
    storeHref("google_play", "app_page", PAID_SEARCH),
  );
  assert.equal(
    runBootstrap({
      userAgent: IPHONE_UA,
      maxTouchPoints: 5,
      surface: "app_page",
      search: PAID_SEARCH,
      finalStore: "app_store",
    }).patchedHref,
    APP_STORE_URL,
  );
});

test("bootstrap은 저장소와 cookie 없이 동작하고 클릭을 capture에서 같은 주소로 보낸다", () => {
  const bootstrap = runBootstrap({
    userAgent: ANDROID_REDUCED_UA,
    maxTouchPoints: 5,
    search: PAID_SEARCH,
  });
  assert.equal(bootstrap.click?.capture, true);
  const expected = downloadHrefFor("android", "landing_hero", PAID_SEARCH);
  assert.deepEqual(bootstrap.clickOnButton(), {
    prevented: true,
    movedTo: expected,
    href: expected,
  });
});

test("수정키와 middle click은 href만 최신화하고 브라우저 기본 동작에 맡긴다", () => {
  const expected = downloadHrefFor("android", "landing_hero", PAID_SEARCH);
  for (const event of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { defaultPrevented: true },
  ]) {
    const bootstrap = runBootstrap({
      userAgent: ANDROID_REDUCED_UA,
      maxTouchPoints: 5,
      search: PAID_SEARCH,
    });
    assert.deepEqual(bootstrap.clickOnButton(event), {
      prevented: false,
      movedTo: "(이동안함)",
      href: expected,
    });
  }
});

test("target=_blank와 download 링크는 iOS 배지 href를 먼저 보존하고 native UX를 유지한다", () => {
  const expected = goHref("app_store", "app_page", PAID_SEARCH);

  for (const attributes of [{ target: "_blank" }, { download: true }]) {
    const bootstrap = runBootstrap({
      userAgent: IPHONE_IOS26_UA,
      maxTouchPoints: 5,
      surface: "app_page",
      search: PAID_SEARCH,
      store: "app_store",
      ...attributes,
    });
    assert.deepEqual(bootstrap.clickOnButton({ button: 0 }), {
      prevented: false,
      movedTo: "(이동안함)",
      href: expected,
    });
  }
});

test("React 다운로드 훅과 bootstrap은 Android에서 같은 캠페인 주소를 만든다", async () => {
  const { mountProbe, window } = await import("./mount-probe.mjs");
  const { AppDownloadHrefProbe } = await import(
    "./fixtures/app-download-href-probe.tsx"
  );

  window.history.replaceState({}, "", `/${PAID_SEARCH}`);
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: ANDROID_REDUCED_UA,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  });

  const storage = window.Storage.prototype;
  const originalGetItem = storage.getItem;
  const originalSetItem = storage.setItem;
  storage.getItem = () => {
    throw new Error("다운로드 React 훅이 브라우저 저장소를 읽음");
  };
  storage.setItem = () => {
    throw new Error("다운로드 React 훅이 브라우저 저장소를 씀");
  };

  const probe = mountProbe(AppDownloadHrefProbe);
  try {
    const expected = downloadHrefFor("android", "landing_hero", PAID_SEARCH);
    assert.equal(probe.latest, expected);
    assert.equal(
      runBootstrap({
        userAgent: ANDROID_REDUCED_UA,
        maxTouchPoints: 5,
        search: PAID_SEARCH,
      }).patchedHref,
      expected,
    );
  } finally {
    probe.unmount();
    storage.getItem = originalGetItem;
    storage.setItem = originalSetItem;
  }
});

test("배지 순서와 기기 판별 기존 UX를 유지한다", () => {
  assert.deepEqual([...STORE_ORDER].sort(), ["app_store", "google_play"]);
  assert.equal(detectMobileOs(IPHONE_UA), "ios");
  assert.equal(detectMobileOs(ANDROID_UA), "android");
  assert.equal(detectMobileOs(ANDROID_REDUCED_UA, 5), "android");
  assert.equal(detectMobileOs(IPHONE_IOS26_UA, 5), "ios");
  assert.equal(detectMobileOs(MAC_UA, 5), "ios");
  assert.equal(detectMobileOs(MAC_UA, 0), null);
});

// GA4 의 동의·사용자 식별·연습 이벤트 명령(ga.ts, ANALYTICS.md §1(1)·(6)). gtag 큐에 실제로 쌓인
// 명령을 본다. 태그를 올리는 일은 모듈 안에서 한 번뿐이라 이 파일의 테스트는 차례로 이어진다 —
// 태그가 없는 동안, 실서비스 호스트에서 태그를 올린 뒤의 순서다. 주소 세척은 analytics-ga.test.mjs 가 본다.
import assert from "node:assert/strict";
import { after, test } from "node:test";

import "./ts-module-loader.mjs";

const {
  clearAnalyticsUser,
  grantAnalyticsConsent,
  revokeAnalyticsConsent,
  setAnalyticsUser,
  startAnalytics,
  toTrackedReferrer,
  trackDialogueStarted,
  trackPageView,
  trackResultViewed,
  trackVideoUploaded,
} = await import("../src/lib/analytics/ga.ts");

const appended = [];

/** gtag 큐와 head 에 붙은 스크립트만 관찰할 수 있으면 되는 최소 브라우저. */
function openBrowser(href, referrer = "") {
  const url = new URL(href);
  globalThis.window = {
    location: {
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
    },
  };
  globalThis.document = {
    referrer,
    title: "연습 화면",
    head: { appendChild: (node) => appended.push(node) },
    createElement: (tag) => ({ tag }),
  };
  return globalThis.window;
}

after(() => {
  delete globalThis.window;
  delete globalThis.document;
});

/** 이 함수 안에서 gtag 큐에 새로 쌓인 명령. */
function queuedDuring(win, run) {
  const before = win.dataLayer?.length ?? 0;
  run();
  return (win.dataLayer ?? []).slice(before).map((args) => Array.from(args));
}

test("정적 프리렌더(window 없음)에서는 태그를 올리지 않는다", () => {
  delete globalThis.window;
  startAnalytics();
  assert.deepEqual(appended, []);
});

test("dev 서버 호스트에서는 태그를 올리지 않고, 태그가 없으면 동의·식별·이벤트 호출이 아무것도 하지 않는다", () => {
  const win = openBrowser("https://dev.acttub.com/home");

  startAnalytics();
  grantAnalyticsConsent();
  setAnalyticsUser("guest-1");
  clearAnalyticsUser();
  trackVideoUploaded(61_000);
  trackDialogueStarted();
  trackResultViewed();
  trackPageView("/home");
  revokeAnalyticsConsent();

  assert.equal(win.gtag, undefined);
  assert.equal(win.dataLayer, undefined);
  assert.deepEqual(appended, []);
});

test("실서비스 호스트에서 태그를 한 번만 올리고, 동의 기본값 denied 가 config 보다 먼저 온다", () => {
  const win = openBrowser(
    "https://acttub.com/home?session=1f0c8a2e&utm_source=instagram",
    "https://acttub.com/practice/history?session=abc",
  );

  startAnalytics();
  startAnalytics();

  const commands = win.dataLayer.map((args) => Array.from(args));
  assert.deepEqual(commands.map(([command]) => command), ["consent", "js", "config"]);
  assert.deepEqual(commands[0], ["consent", "default", { analytics_storage: "denied" }]);
  assert.deepEqual(commands[2], [
    "config",
    "G-DRMEWBN9Y9",
    {
      send_page_view: false,
      page_location: "https://acttub.com/home?utm_source=instagram",
      page_referrer: "https://acttub.com/practice/history",
    },
  ]);
  assert.deepEqual(appended, [
    { tag: "script", async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-DRMEWBN9Y9" },
  ]);
});

test("켠 적 없는 동의는 거둘 것이 없고, 동의는 한 번만 granted 로 올린다", () => {
  const win = globalThis.window;

  assert.deepEqual(queuedDuring(win, () => revokeAnalyticsConsent()), []);
  assert.deepEqual(
    queuedDuring(win, () => {
      grantAnalyticsConsent();
      grantAnalyticsConsent();
    }),
    [["consent", "update", { analytics_storage: "granted" }]],
  );
});

test("user_id 는 게스트 id 로 set 하고, 같은 값은 다시 보내지 않으며 다른 게스트로 바뀌면 다시 보낸다", () => {
  const win = globalThis.window;

  assert.deepEqual(
    queuedDuring(win, () => {
      setAnalyticsUser("guest-1");
      setAnalyticsUser("guest-1");
      setAnalyticsUser("guest-2");
    }),
    [
      ["set", { user_id: "guest-1" }],
      ["set", { user_id: "guest-2" }],
    ],
  );
});

test("연습 이벤트는 세션 id 없이 길이 구간만 싣는다", () => {
  const win = globalThis.window;

  assert.deepEqual(
    queuedDuring(win, () => {
      trackVideoUploaded(61_000);
      trackVideoUploaded(Number.NaN);
      trackDialogueStarted();
      trackResultViewed();
    }),
    [
      ["event", "practice_video_uploaded", { duration_bucket: "60-180s" }],
      ["event", "practice_video_uploaded", { duration_bucket: "unknown" }],
      ["event", "practice_dialogue_started"],
      ["event", "practice_result_viewed"],
    ],
  );
});

test("계측이 꺼지면 user_id 를 한 번만 지우고 동의를 denied 로 되돌린다", () => {
  const win = globalThis.window;

  assert.deepEqual(
    queuedDuring(win, () => {
      clearAnalyticsUser();
      clearAnalyticsUser();
      revokeAnalyticsConsent();
      revokeAnalyticsConsent();
    }),
    [
      ["set", { user_id: null }],
      ["consent", "update", { analytics_storage: "denied" }],
    ],
  );
});

test("주소로 읽을 수 없는 referrer 는 보내지 않는다", () => {
  assert.equal(toTrackedReferrer("not a url", "https://acttub.com"), "");
  assert.equal(toTrackedReferrer("ftp://files.example.com/a", "https://acttub.com"), "");
});

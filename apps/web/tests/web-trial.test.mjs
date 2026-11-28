// 사이트 머리 메뉴와 체험 퍼널 이벤트(trial_*, SOMA-834 3차). 웹 체험 화면(리딩 빠른 시작·체험 띠·앱 이어하기 카드)은
// 웹 연습 기능과 함께 지웠고, 이벤트 함수는 lib/analytics/ga.ts 에 남아 있다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./mount-probe.mjs";
import { resetNavigation } from "./fixtures/features-next-shims.mjs";

const { cleanup } = await import("@testing-library/react");
const { clearTokens } = await import("../src/lib/auth/token-store.ts");
const ga = await import("../src/lib/analytics/ga.ts");
const { SITE_NAV } = await import("../src/features/site/site-chrome.tsx");

const events = [];
beforeEach(() => {
  events.length = 0;
  resetNavigation("/");
  clearTokens();
  window.history.replaceState(null, "", "/");
  window.gtag = (...args) => events.push(args);
  globalThis.window.gtag = window.gtag;
});
afterEach(() => {
  cleanup();
  clearTokens();
  delete window.gtag;
});

const sent = () => events.map(([, name, params]) => [name, params]);

test("머리 메뉴는 요금·블로그만 둔다", () => {
  assert.deepEqual(
    SITE_NAV.map((item) => [item.label, item.href]),
    [
      ["요금", "/pricing"],
      ["블로그", "/blog"],
    ],
  );
});

test("체험 이벤트는 정해진 이름과 파라미터만 싣는다", () => {
  ga.trackTrialStart("reading", "quick_start");
  ga.trackTrialStart("coaching", "home_card");
  ga.trackTrialFirstPartnerLine();
  ga.trackTrialComplete("reading");
  ga.trackTrialComplete("coaching");
  ga.trackTrialAppClick("coaching", "home");
  assert.deepEqual(sent(), [
    ["trial_start", { feature: "reading", entry: "quick_start", transport_type: "beacon" }],
    ["trial_start", { feature: "coaching", entry: "home_card", transport_type: "beacon" }],
    ["trial_first_partner_line", { feature: "reading", transport_type: "beacon" }],
    ["trial_complete", { feature: "reading", transport_type: "beacon" }],
    ["trial_complete", { feature: "coaching", transport_type: "beacon" }],
    ["trial_app_click", { feature: "coaching", surface: "home", transport_type: "beacon" }],
  ]);
});

test("태그가 아직 없으면(동의 흐름 전) 오류 없이 지나가고 바로 보내지 않는다", () => {
  delete window.gtag;
  delete globalThis.window.gtag;
  assert.doesNotThrow(() => {
    ga.trackTrialStart("reading", "nav");
    ga.trackTrialComplete("coaching");
  });
  assert.deepEqual(events, []);
});

// 랜딩(/). 이 브라우저에서 연습하던 게스트는 랜딩을 건너뛰고 /home 으로 가고, 연습 화면 로고처럼
// ?intro=1 로 들어온 경우만 랜딩을 그대로 본다. 광고로 들어온 UTM 은 연습으로 가는 링크에 실린다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { navigation, resetNavigation } from "./fixtures/features-next-shims.mjs";

const { act, cleanup, render, screen } = await import("@testing-library/react");
const { default: LandingClient } = await import("../src/app/landing-client.tsx");
const { default: LandingPage, metadata } = await import("../src/app/page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

class FakeIntersectionObserver {
  static all = [];
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    FakeIntersectionObserver.all.push(this);
  }
  observe(target) {
    this.targets.push(target);
  }
  unobserve(target) {
    this.targets = this.targets.filter((t) => t !== target);
  }
  disconnect() {
    this.targets = [];
  }
}

function intersect(element, isIntersecting) {
  act(() => {
    for (const observer of FakeIntersectionObserver.all) {
      if (observer.targets.includes(element)) {
        observer.callback([{ target: element, isIntersecting }]);
      }
    }
  });
}

function visit(search) {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => {
  FakeIntersectionObserver.all = [];
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  resetNavigation("/");
  clearTokens();
  visit("");
});

afterEach(() => {
  cleanup();
  clearTokens();
  delete globalThis.IntersectionObserver;
});

test("처음 온 사람은 랜딩에 머물고, 연습 링크와 앱 받기 링크를 본다", () => {
  render(react.createElement(LandingClient));

  assert.deepEqual(navigation.pushed, []);
  assert.deepEqual(
    screen.getAllByRole("link", { name: "앱 없이 바로 해 보기" }).map((a) => a.getAttribute("href")),
    ["/practice/new", "/practice/new"],
  );
  assert.equal(
    screen.getByRole("link", { name: "앱 없이 웹으로 계속하기 →" }).getAttribute("href"),
    "/practice/new",
  );
  // 데스크톱 브라우저라 기기를 못 가린다. 두 스토어를 다 보여 주는 /app 으로 보낸다.
  assert.deepEqual(
    screen.getAllByRole("link", { name: "앱 다운로드" }).map((a) => a.getAttribute("href")),
    ["/app", "/app"],
  );
  // 히어로 둘, 아래 권유 하나, 고정 바 하나.
  assert.deepEqual(
    screen.getAllByRole("link", { name: "앱 다운받기", hidden: true }).map((a) => a.getAttribute("href")),
    ["/app", "/app", "/app", "/app"],
  );
  assert.deepEqual(
    ["독백 연습 혼자 하는 법", "셀프테이프 찍는 법"].map((name) =>
      screen.getByRole("link", { name }).getAttribute("href"),
    ),
    ["/guide/monologue-practice", "/guide/self-tape"],
  );
  assert.equal(
    screen.getAllByRole("link", { name: "acttub0527@gmail.com" })[0].getAttribute("href"),
    "mailto:acttub0527@gmail.com",
  );
});

test("광고로 들어온 UTM 은 연습으로 가는 링크에 그대로 실리고, 추적 식별자는 버린다", () => {
  visit("?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch&fbclid=abc");
  render(react.createElement(LandingClient));

  assert.equal(
    screen.getByRole("link", { name: "앱 없이 웹으로 계속하기 →" }).getAttribute("href"),
    "/practice/new?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch",
  );
});

test("이 브라우저에 게스트가 있으면 UTM 을 실은 채 /home 으로 옮긴다", () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  visit("?utm_source=naver&utm_medium=cpc");

  render(react.createElement(LandingClient));

  assert.deepEqual(navigation.pushed, ["/home?utm_source=naver&utm_medium=cpc"]);
});

test("게스트라도 ?intro=1 로 일부러 들어오면 랜딩을 그대로 보여 준다", () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  visit("?intro=1");

  render(react.createElement(LandingClient));

  assert.deepEqual(navigation.pushed, []);
});

test("화면에 들어온 구역은 한 번 보이면 보인 채로 남는다", () => {
  render(react.createElement(LandingClient));
  const sections = [...window.document.querySelectorAll("[data-reveal]")];
  const first = sections[0];

  intersect(first, false);
  assert.equal(first.dataset.visible, undefined);

  intersect(first, true);
  assert.equal(first.dataset.visible, "true");

  intersect(first, false);
  assert.equal(first.dataset.visible, "true");
});

test("첫 화면이 헤더 밑으로 들어가면 아래 고정 다운로드 바가 나타난다", () => {
  render(react.createElement(LandingClient));
  const hero = window.document.getElementById("hero");
  const bar = () => screen.getByText("iOS · Android 무료").closest("[aria-hidden]");

  assert.equal(bar().getAttribute("aria-hidden"), "true");
  intersect(hero, false);
  assert.equal(bar().getAttribute("aria-hidden"), "false");
  intersect(hero, true);
  assert.equal(bar().getAttribute("aria-hidden"), "true");
});

test("랜딩 페이지는 검색엔진용 구조화 데이터 셋을 싣고 주소를 / 로 알린다", () => {
  const { container } = render(react.createElement(LandingPage));

  const types = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent)["@type"],
  );
  assert.deepEqual(types, ["WebSite", "SoftwareApplication", "Organization"]);
  assert.equal(metadata.alternates.canonical, "/");
});

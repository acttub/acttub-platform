// 랜딩(/). 이 브라우저에서 연습하던 게스트도 랜딩을 그대로 보고, 첫 화면 링크만 「이어서 연습하기」로 바뀐다.
// 광고로 들어온 UTM 은 연습으로 가는 링크에 실린다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { navigation, resetNavigation } from "./fixtures/features-next-shims.mjs";

const { act, cleanup, render, screen, within } = await import("@testing-library/react");
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

test("처음 온 사람은 홈에 머물고, 웹 체험 링크와 앱 받기 링크와 운영 창구를 본다", () => {
  render(react.createElement(LandingClient));

  assert.deepEqual(navigation.pushed, []);
  assert.equal(
    screen.getByRole("link", { name: "웹에서 먼저 해 보기 →" }).getAttribute("href"),
    "/practice/new",
  );
  // 코칭은 영상 코칭 체험으로, 리딩은 웹 리딩으로, 바닥은 웹 연습 홈으로. 챌린지는 웹 목록이 없어 앱으로만 보낸다.
  assert.deepEqual(
    screen.getAllByRole("link", { name: "웹에서 해 보기" }).map((a) => a.getAttribute("href")),
    ["/practice/new", "/reading", "/home"],
  );
  // 데스크톱 브라우저라 기기를 못 가린다. 두 스토어를 다 보여 주는 /app 으로 보낸다.
  assert.equal(screen.getByRole("link", { name: "앱에서 시작하기" }).getAttribute("href"), "/app");
  assert.equal(screen.getByRole("link", { name: "앱 열기 · 무료로 설치" }).getAttribute("href"), "/app");
  assert.deepEqual(
    ["앱에서 코칭 받기", "앱에서 리딩하기", "앱에서 참여하기"].map((name) =>
      screen.getByRole("link", { name }).getAttribute("href"),
    ),
    ["/app", "/app", "/app"],
  );
  // 운영 창구: 고객센터·요금·로그인이 머리에 있고, 바닥에 문의하기·계정 삭제가 있다.
  assert.ok(screen.getAllByRole("link", { name: "고객센터" }).every((a) => a.getAttribute("href") === "/help"));
  const header = window.document.querySelector("header");
  assert.equal(within(header).getByRole("link", { name: "요금" }).getAttribute("href"), "/pricing");
  assert.equal(within(header).getByRole("link", { name: "로그인" }).getAttribute("href"), "/login");
  assert.equal(screen.getByRole("link", { name: "계정 삭제" }).getAttribute("href"), "/account#delete");
  assert.ok(screen.getAllByRole("link", { name: "문의하기" }).some((a) => a.getAttribute("href") === "/help/contact"));
  assert.ok(screen.getAllByRole("img", { name: "앱 설치 QR 코드", hidden: true }).every((img) => img.getAttribute("src").includes("app-qr.svg")));
  assert.equal(
    screen.getAllByRole("link", { name: "acttub0527@gmail.com" })[0].getAttribute("href"),
    "mailto:acttub0527@gmail.com",
  );
});

test("광고로 들어온 UTM 은 웹 체험으로 가는 링크에 그대로 실리고, 추적 식별자는 버린다", () => {
  visit("?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch&fbclid=abc");
  render(react.createElement(LandingClient));

  assert.equal(
    screen.getByRole("link", { name: "웹에서 먼저 해 보기 →" }).getAttribute("href"),
    "/practice/new?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch",
  );
});

test("이 브라우저에 게스트가 있어도 홈에 머물고, 첫 화면 링크가 UTM 을 실은 「이어서 연습하기」가 된다", () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  visit("?utm_source=naver&utm_medium=cpc");

  render(react.createElement(LandingClient));

  assert.deepEqual(navigation.pushed, []);
  assert.equal(
    screen.getByRole("link", { name: "이어서 연습하기 →" }).getAttribute("href"),
    "/home?utm_source=naver&utm_medium=cpc",
  );
  assert.equal(screen.queryByRole("link", { name: "웹에서 먼저 해 보기 →" }), null);
});

test("게스트가 ?intro=1 이나 소개 링크(#coaching)로 들어와도 홈을 그대로 보여 준다", () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  for (const url of ["/?intro=1", "/#coaching"]) {
    window.history.replaceState(null, "", url);
    render(react.createElement(LandingClient));
    assert.deepEqual(navigation.pushed, []);
    cleanup();
  }
  window.history.replaceState(null, "", "/");
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

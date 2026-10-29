// 랜딩(/) 첫 화면 A/B(SOMA-918): 배정·고정·강제·봇 처리, B 화면 구성, GA4 이벤트 파라미터.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { resetNavigation } from "./fixtures/features-next-shims.mjs";

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { default: LandingClient } = await import("../src/app/landing-client.tsx");
const {
  decideLandingVariant,
  isBotUserAgent,
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_REWRITE_HEADER,
  landingVariantPath,
} = await import("../src/lib/landing-variant.ts");
const { proxy } = await import("../src/proxy.ts");
const { NextRequest } = await import("next/server");

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

function decide(overrides = {}) {
  return decideLandingVariant({ forced: null, cookie: null, userAgent: CHROME, random: () => 0.1, ...overrides });
}

test("처음 온 방문자는 난수로 50:50 나뉘고 쿠키를 받는다", () => {
  assert.deepEqual(decide({ random: () => 0.49 }), { variant: "a", setCookie: true });
  assert.deepEqual(decide({ random: () => 0.5 }), { variant: "b", setCookie: true });
  let a = 0;
  for (let i = 0; i < 1000; i += 1) if (decide({ random: () => i / 1000 }).variant === "a") a += 1;
  assert.equal(a, 500);
});

test("쿠키가 있으면 난수와 상관없이 같은 안을 보고 쿠키를 다시 심지 않는다", () => {
  assert.deepEqual(decide({ cookie: "b", random: () => 0.0 }), { variant: "b", setCookie: false });
  assert.deepEqual(decide({ cookie: "a", random: () => 0.99 }), { variant: "a", setCookie: false });
  // 알 수 없는 값은 없는 것으로 보고 새로 배정한다.
  assert.deepEqual(decide({ cookie: "c", random: () => 0.9 }), { variant: "b", setCookie: true });
});

test("?hero=a|b 는 쿠키보다 앞서고 쿠키를 바꾸지 않는다", () => {
  assert.deepEqual(decide({ forced: "b", cookie: "a" }), { variant: "b", setCookie: false });
  assert.deepEqual(decide({ forced: "a", cookie: "b" }), { variant: "a", setCookie: false });
  assert.deepEqual(decide({ forced: "zzz", cookie: "b" }), { variant: "b", setCookie: false });
});

test("검색 봇·미리보기·UA 없음은 항상 A 이고 쿠키도 강제도 받지 않는다", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "kakaotalk-scrap/1.0",
    "Mozilla/5.0 Chrome-Lighthouse",
    "",
    null,
  ]) {
    assert.equal(isBotUserAgent(ua), true, String(ua));
    assert.deepEqual(decide({ userAgent: ua, forced: "b", cookie: "b", random: () => 0.9 }), { variant: "a", setCookie: false });
  }
  assert.equal(isBotUserAgent(CHROME), false);
});

function request(url, { cookie, ua = CHROME, extra = {} } = {}) {
  const headers = { "user-agent": ua, ...extra };
  if (cookie) headers.cookie = `${LANDING_VARIANT_COOKIE}=${cookie}`;
  return new NextRequest(url, { headers });
}

test("프록시는 / 를 안별 정적 페이지로 다시 쓰고, 처음 온 사람에게만 쿠키를 심는다", () => {
  const first = proxy(request("https://acttub.com/"));
  const target = first.headers.get("x-middleware-rewrite");
  assert.ok(target.endsWith(landingVariantPath("a")) || target.endsWith(landingVariantPath("b")));
  const cookie = first.cookies.get(LANDING_VARIANT_COOKIE);
  assert.ok(["a", "b"].includes(cookie.value));
  assert.equal(cookie.maxAge, 60 * 60 * 24 * 180);
  assert.equal(cookie.path, "/");
  assert.equal(first.headers.get("cache-control"), "private, no-cache, must-revalidate");
  assert.match(first.headers.get("vary"), /Cookie/);

  // 같은 쿠키로 다시 오면 같은 안이고 쿠키를 새로 심지 않는다.
  const again = proxy(request("https://acttub.com/", { cookie: cookie.value }));
  assert.ok(again.headers.get("x-middleware-rewrite").endsWith(landingVariantPath(cookie.value)));
  assert.equal(again.cookies.get(LANDING_VARIANT_COOKIE), undefined);
});

test("프록시: ?hero 강제는 쿠키 없이 그 안을 보이고, 봇은 A, 안별 주소 직접 접근은 / 로 돌린다", () => {
  const forced = proxy(request("https://acttub.com/?hero=b&utm_source=x", { cookie: "a" }));
  assert.ok(forced.headers.get("x-middleware-rewrite").endsWith(landingVariantPath("b")));
  assert.equal(forced.cookies.get(LANDING_VARIANT_COOKIE), undefined);

  const bot = proxy(request("https://acttub.com/?hero=b", { ua: "Googlebot/2.1" }));
  assert.ok(bot.headers.get("x-middleware-rewrite").endsWith(landingVariantPath("a")));
  assert.equal(bot.cookies.get(LANDING_VARIANT_COOKIE), undefined);

  const direct = proxy(request("https://acttub.com/landing-variants/b"));
  assert.equal(direct.status, 308);
  assert.equal(new URL(direct.headers.get("location")).pathname, "/");
});

test("프록시: rewrite 는 표시를 실어 보내고, next dev 가 그 주소로 다시 부르면 돌려보내지 않고 통과시킨다", () => {
  // next dev 는 rewrite 한 /landing-variants/x 로 프록시를 한 번 더 부른다. 예전에는 이걸 직접 접근으로 보고
  // / 로 308 을 보내 / → rewrite → 308 → / … 루프가 났다.
  const first = proxy(request("https://acttub.com/?hero=b"));
  assert.ok(first.headers.get("x-middleware-rewrite").endsWith(landingVariantPath("b")));
  assert.equal(first.headers.get(`x-middleware-request-${LANDING_VARIANT_REWRITE_HEADER}`), "1");
  assert.match(first.headers.get("x-middleware-override-headers"), new RegExp(LANDING_VARIANT_REWRITE_HEADER));

  for (const variant of ["a", "b"]) {
    const second = proxy(
      request(`https://acttub.com${landingVariantPath(variant)}`, { extra: { [LANDING_VARIANT_REWRITE_HEADER]: "1" } }),
    );
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("location"), null);
    assert.equal(second.headers.get("x-middleware-next"), "1");
  }

  // 표시가 다른 값이면 직접 접근으로 본다.
  const forged = proxy(request("https://acttub.com/landing-variants/b", { extra: { [LANDING_VARIANT_REWRITE_HEADER]: "yes" } }));
  assert.equal(forged.status, 308);
});

// ── 화면 ────────────────────────────────────────────────────────────────────

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
  unobserve() {}
  disconnect() {}
  static fire(isIntersecting) {
    for (const observer of FakeIntersectionObserver.all) {
      observer.callback(observer.targets.map((target) => ({ target, isIntersecting })));
    }
  }
}

const events = [];
const mediaCalls = [];
const { HTMLMediaElement } = window;
const originalPlay = HTMLMediaElement.prototype.play;
const originalPause = HTMLMediaElement.prototype.pause;

beforeEach(() => {
  FakeIntersectionObserver.all = [];
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  resetNavigation("/");
  events.length = 0;
  mediaCalls.length = 0;
  HTMLMediaElement.prototype.play = function play() {
    mediaCalls.push("play");
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    mediaCalls.push("pause");
  };
  window.gtag = (...args) => events.push(args);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  delete window.gtag;
  delete globalThis.IntersectionObserver;
  HTMLMediaElement.prototype.play = originalPlay;
  HTMLMediaElement.prototype.pause = originalPause;
});

const SUMMARY_LAST = "매주 공식 대사 챌린지";
const FEATURE_BODY = "찍어 둔 연기 영상을 올리면 코치가 장면을 보고 질문해요.";
const VIDEO_MEDIA = {
  poster: "/site/landing/coach-demo-poster.jpg",
  sources: [
    { src: "/site/landing/coach-demo.webm", type: "video/webm" },
    { src: "/site/landing/coach-demo.mp4", type: "video/mp4" },
  ],
};

function renderB(props = {}) {
  return render(react.createElement(LandingClient, { variant: "b", ...props }));
}

test("A 는 기존 첫 화면 그대로다: 휴대폰 두 대와 큰 QR 카드·스토어 배지", () => {
  const { container } = render(react.createElement(LandingClient, { variant: "a" }));
  const hero = container.querySelector("#hero");
  assert.equal(hero.querySelectorAll('img[src*="shot-"]').length, 2);
  assert.equal(hero.querySelectorAll('img[alt$="에서 다운로드"]').length, 2);
  assert.ok(hero.textContent.includes("혼자 연습하는 배우를 위한 AI 코치"));
  assert.equal(hero.querySelector("video"), null);
});

test("B 는 첫 화면만 다르고 아래 본문(요약 줄·기능 설명·요금)은 A 와 같다", () => {
  const a = render(react.createElement(LandingClient, { variant: "a" })).container;
  const below = (root) => [...root.querySelectorAll("main > *")].slice(0).map((node) => node.cloneNode(true));
  const aBelow = below(a).map((node) => {
    node.querySelector("#hero")?.remove();
    return node.outerHTML;
  });
  cleanup();
  const b = renderB().container;
  const bBelow = below(b).map((node) => {
    node.querySelector("#hero")?.remove();
    return node.outerHTML;
  });
  assert.deepEqual(bBelow, aBelow);
  assert.ok(screen.getByText(/매주/, { selector: "li" }).textContent.includes(SUMMARY_LAST));
  assert.ok(b.textContent.includes(FEATURE_BODY));
  assert.equal(b.querySelectorAll('img[src*="acty"]').length, 0);
});

test("B 첫 화면: 같은 제목, 짧은 설명, 주 버튼 하나, 작은 웹 체험 링크, 휴대폰 한 대", () => {
  const { container } = renderB();
  const hero = container.querySelector("#hero");
  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "내 연기를 같이 봐 줄사람이 없을 때, 액터브",
  );
  assert.ok(hero.textContent.includes("연기 영상을 올리면 코치가 장면을 보고 질문해요."));
  // 주 버튼은 하나, 큰 QR 카드·스토어 배지 이미지는 없다(작은 글자 링크만).
  assert.equal(hero.querySelectorAll('a[data-app-download]:not([data-app-download-store])').length, 1);
  assert.equal(hero.querySelectorAll('img[alt$="에서 다운로드"]').length, 0);
  assert.deepEqual(
    [...hero.querySelectorAll("a[data-app-download-store]")].map((a) => a.textContent),
    ["App Store", "Google Play"],
  );
  assert.ok(within(hero).getByRole("link", { name: "웹에서 먼저 해 보기 →" }));
  assert.ok(!hero.textContent.includes("혼자 연습하는 배우를 위한 AI 코치"));
  // 영상이 아직 없으면 기존 코칭 화면 한 장만 보이고 video 는 만들지 않는다.
  const shots = [...hero.querySelectorAll('img[src*="shot-"]')];
  assert.equal(shots.length, 1);
  assert.match(decodeURIComponent(shots[0].getAttribute("src")), /shot-coach\.jpg/);
  assert.equal(hero.querySelector("video"), null);
});

test("B 첫 화면 영상: 소리 없이 반복, 인라인, 메타데이터만 미리, poster 와 파일 순서대로", () => {
  const { container } = renderB({ heroMedia: VIDEO_MEDIA });
  const video = container.querySelector("#hero video");
  assert.ok(video.muted);
  assert.ok(video.hasAttribute("loop"));
  assert.ok(video.hasAttribute("playsinline"));
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.equal(video.getAttribute("poster"), VIDEO_MEDIA.poster);
  assert.deepEqual(
    [...video.querySelectorAll("source")].map((source) => [source.getAttribute("src"), source.getAttribute("type")]),
    VIDEO_MEDIA.sources.map((source) => [source.src, source.type]),
  );
  // 정지 화면이 영상 밑에 깔려 있다.
  assert.ok(decodeURIComponent(container.querySelector("#hero img[alt*='코치']").getAttribute("src")).includes("coach-demo-poster.jpg"));
});

test("B 첫 화면 영상: 화면에 들어오면 재생하고 나가면 멈춘다", () => {
  renderB({ heroMedia: VIDEO_MEDIA });
  assert.deepEqual(mediaCalls, []);
  FakeIntersectionObserver.fire(true);
  FakeIntersectionObserver.fire(false);
  assert.deepEqual(mediaCalls, ["play", "pause"]);
});

test("B 첫 화면 영상: 움직임 줄이기면 화면에 들어와도 재생하지 않는다", () => {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    renderB({ heroMedia: VIDEO_MEDIA });
    FakeIntersectionObserver.fire(true);
    assert.ok(!mediaCalls.includes("play"));
  } finally {
    window.matchMedia = original;
  }
});

test("노출되면 landing_variant_view 에 안 이름이 실린다", () => {
  render(react.createElement(LandingClient, { variant: "b" }));
  assert.deepEqual(
    events.map(([kind, name, params]) => [kind, name, params.landing_variant]),
    [["event", "landing_variant_view", "b"]],
  );
});

test("태그가 아직 없어도 오류 없이 지나가고 아무것도 바로 보내지 않는다", () => {
  delete window.gtag;
  const { container } = render(react.createElement(LandingClient, { variant: "a" }));
  fireEvent.click(container.querySelector("a[data-app-download]"));
  assert.equal(events.length, 0);
});

test("앱 다운로드 버튼·스토어 배지·웹 체험 클릭에 안 이름과 자리가 실린다", () => {
  const { container } = render(react.createElement(LandingClient, { variant: "b" }));
  events.length = 0;

  fireEvent.click(screen.getByRole("link", { name: "앱 열기 · 무료로 설치" }));
  const heroBadge = container.querySelector('a[data-app-download="landing_hero"][data-app-download-store="app_store"]');
  fireEvent.click(heroBadge);
  fireEvent.click(container.querySelector('a[data-app-download="landing_cta"][data-app-download-store="google_play"]'));
  fireEvent.click(screen.getByRole("link", { name: "웹에서 먼저 해 보기 →" }));
  fireEvent.click(within(window.document.getElementById("reading")).getByRole("link", { name: "웹에서 해 보기" }));

  const rows = events.map(([, name, p]) => [name, p.landing_variant, p.surface, p.store ?? null]);
  assert.deepEqual(rows, [
    ["app_download_click", "b", "landing_hero", "auto"],
    ["app_download_click", "b", "landing_hero", "app_store"],
    ["app_download_click", "b", "landing_cta", "google_play"],
    ["web_try_click", "b", "landing_hero", null],
    ["web_try_click", "b", "landing_reading", null],
  ]);
});

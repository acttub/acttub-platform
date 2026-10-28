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
const { DEMO_ANSWER, DEMO_NEXT_TAKE, DEMO_QUESTION, DEMO_TIMELINE, demoFrameAt } = await import(
  "../src/features/site/acty-coach-demo.tsx"
);
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
  observe() {}
  unobserve() {}
  disconnect() {}
}

const events = [];

beforeEach(() => {
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  resetNavigation("/");
  events.length = 0;
  window.gtag = (...args) => events.push(args);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  delete window.gtag;
  delete globalThis.IntersectionObserver;
});

const SUMMARY = ["코치가 질문하며 장면을 같이 봐요", "상대역이 없어도 대사가 오가요", "매주 공식 대사 챌린지"];

test("A 는 기존 화면 그대로다: 요약 카드 셋이 있고 액티는 없고 기존 설명이다", () => {
  const { container } = render(react.createElement(LandingClient, { variant: "a" }));
  assert.ok(screen.getByText(/매주/, { selector: "li" }));
  assert.equal(SUMMARY.length, 3);
  assert.equal(container.querySelectorAll('img[src*="acty"]').length, 0);
  assert.ok(container.textContent.includes("찍어 둔 연기 영상을 올리면 코치가 장면을 보고 질문해요."));
  assert.ok(!container.textContent.includes("대본 외우고, 찍고, 코멘트 받고, 다시."));
});

test("B 는 요약 카드를 빼고, 액티는 첫 화면 코칭 시연 하나만 두고, 설명만 배우 말투로 바꾼다", () => {
  const { container } = render(react.createElement(LandingClient, { variant: "b" }));
  assert.equal(container.querySelector("ul.sm\\:justify-center"), null);
  assert.equal(screen.queryByText("매주", { selector: "li b" }), null);

  // 액티는 첫 화면 시연 안에만 있다. 테스트 환경은 next/image 가 /_next/image?url=... 로 감싼다.
  const acty = [...container.querySelectorAll('img[src*="acty"]')];
  assert.deepEqual(
    acty.map((img) => decodeURIComponent(img.getAttribute("src")).match(/acty\/([\w-]+\.png)/)[1]),
    ["hero-watch.png", "hero-cheer.png"],
  );
  const demo = container.querySelector(".acty-demo");
  assert.ok(acty.every((img) => demo.contains(img) && img.getAttribute("alt") === ""));
  assert.equal(container.querySelectorAll("#coaching img[src*='acty'], #reading img[src*='acty'], #challenge img[src*='acty']").length, 0);
  // 정적 스크린샷 대신 HTML 로 그린 휴대폰이다.
  assert.equal(container.querySelectorAll('#hero img[src*="shot-"]').length, 0);

  assert.ok(container.textContent.includes("대본 외우고, 찍고, 코멘트 받고, 다시."));
  assert.ok(container.textContent.includes("상대역이 없을 때도 대본을 맞춰 볼 수 있어요."));
  assert.ok(container.textContent.includes("다른 배우는 어떻게 했는지 구경하고"));
  // 제목·요금은 그대로.
  assert.ok(screen.getByRole("heading", { name: /단정하지 않고,\s*장면을 같이 봐요/ }));
  assert.ok(container.textContent.includes("월 3,900원"));
});

test("B 첫 화면 시연: 움직이는 영역은 읽지 않고, 같은 대화를 스크린리더용 문장으로 한 번 읽어 준다", () => {
  const { container } = render(react.createElement(LandingClient, { variant: "b" }));
  const demo = container.querySelector(".acty-demo");
  assert.equal(demo.getAttribute("aria-hidden"), "true");
  const srOnly = [...container.querySelectorAll("#hero .sr-only")].map((node) => node.textContent);
  assert.equal(srOnly.length, 1);
  for (const text of [DEMO_QUESTION, DEMO_ANSWER, DEMO_NEXT_TAKE]) {
    assert.ok(srOnly[0].includes(text), text);
    // 휴대폰 안에도 실제 글자로 있다(질문은 글자마다 나뉘어 있다).
    assert.ok(demo.textContent.includes(text), text);
  }
  // 화면에 들어오기 전(IntersectionObserver 미발화)에는 멈춰 있고 첫 장면이다.
  assert.equal(demo.getAttribute("data-paused"), "");
  assert.equal(demo.getAttribute("data-step"), "0");
});

test("B 첫 화면 시연 시간표: 영상 → 질문 타이핑 → 답 → 다음 테이크 → 처음부터, 한 바퀴 5~7초", () => {
  const T = DEMO_TIMELINE;
  const chars = Array.from(DEMO_QUESTION).length;
  assert.ok(T.LOOP >= 5000 && T.LOOP <= 7000, String(T.LOOP));
  assert.ok(T.PLAY_MS < T.ASK && T.ASK < T.TYPE_START && T.TYPE_END < T.ANSWER && T.ANSWER < T.NEXT && T.NEXT < T.LOOP);
  assert.deepEqual(demoFrameAt(0), { loop: 0, step: 0, typed: 0 });
  assert.equal(demoFrameAt(T.ASK).step, 1);
  const mid = demoFrameAt((T.TYPE_START + T.TYPE_END) / 2);
  assert.ok(mid.typed > 0 && mid.typed < chars);
  assert.equal(demoFrameAt(T.TYPE_END).typed, chars);
  assert.equal(demoFrameAt(T.ANSWER).step, 2);
  assert.equal(demoFrameAt(T.NEXT).step, 3);
  // 다음 바퀴: 처음 잠깐은 앞 질문이 사라지는 동안 글자를 그대로 두고, 그 뒤 비운다.
  assert.deepEqual(demoFrameAt(T.LOOP + 10), { loop: 1, step: 0, typed: chars });
  assert.deepEqual(demoFrameAt(T.LOOP + 400), { loop: 1, step: 0, typed: 0 });
});

test("B 첫 화면 시연: 움직임 줄이기면 마지막 장면(질문·답·다음 테이크)을 멈춘 채 보인다", () => {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    const { container } = render(react.createElement(LandingClient, { variant: "b" }));
    const demo = container.querySelector(".acty-demo");
    assert.equal(demo.getAttribute("data-step"), "3");
    assert.equal(demo.getAttribute("data-paused"), "");
    assert.equal(demo.querySelectorAll(".acty-demo-rest").length, 0);
    assert.equal(demo.querySelectorAll(".acty-demo-caret").length, 0);
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

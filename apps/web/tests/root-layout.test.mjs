// 모든 화면을 감싸는 루트 셸: 루트 레이아웃(인스타 인앱 탈출 스크립트), 마지막 오류 화면, 404, 글꼴 시트.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

const captured = [];
globalThis.__rootLayoutSentry = captured;
const sentryModule = `data:text/javascript,${encodeURIComponent(
  "export const captureException = (error) => globalThis.__rootLayoutSentry.push(error.message);",
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (specifier === "@sentry/nextjs") return { url: sentryModule, shortCircuit: true };
    if (specifier.endsWith(".css")) {
      return { url: "data:text/javascript,export default {};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { renderToStaticMarkup } = await import("react-dom/server");
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { default: RootLayout, metadata: rootMetadata } = await import("../src/app/layout.tsx");
const { default: GlobalError } = await import("../src/app/global-error.tsx");
const { default: NotFound, metadata: notFoundMetadata } = await import("../src/app/not-found.tsx");
const { PretendardStylesheet } = await import("../src/app/pretendard-stylesheet.tsx");
const { version: pretendardVersion } = (
  await import("pretendard/package.json", { with: { type: "json" } })
).default;

afterEach(() => {
  cleanup();
  captured.length = 0;
  window.document.getElementById("pretendard-dynamic-subset")?.remove();
});

/** 루트 레이아웃의 첫 인라인 스크립트(인앱 탈출)를 주어진 브라우저 상태에서 돌린다. */
function runInAppEscape({ userAgent, href, webdriver = false }) {
  const markup = renderToStaticMarkup(
    react.createElement(RootLayout, null, react.createElement("p", null, "본문")),
  );
  const script = markup.match(/<head><script>([\s\S]*?)<\/script>/)[1];
  const url = new URL(href);
  const replaced = [];
  runInNewContext(script, {
    navigator: { userAgent, webdriver },
    location: {
      href: url.href,
      search: url.search,
      replace: (target) => replaced.push(target),
    },
    URLSearchParams,
  });
  return replaced;
}

const INSTAGRAM_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 345.0.0.0.0";
const INSTAGRAM_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

test("안드로이드 인스타 인앱 브라우저는 같은 주소를 기본 브라우저로 넘긴다(해시는 뺀다)", () => {
  assert.deepEqual(
    runInAppEscape({ userAgent: INSTAGRAM_ANDROID, href: "https://acttub.com/app?utm_source=instagram#download" }),
    ["intent://acttub.com/app?utm_source=instagram#Intent;scheme=https;end"],
  );
});

test("아이폰 인앱, 인앱이 아닌 브라우저, ?ib=1 로 돌아온 경우, 자동화 브라우저는 그대로 둔다", () => {
  assert.deepEqual(runInAppEscape({ userAgent: INSTAGRAM_IPHONE, href: "https://acttub.com/app" }), []);
  assert.deepEqual(runInAppEscape({ userAgent: CHROME_ANDROID, href: "https://acttub.com/app" }), []);
  assert.deepEqual(
    runInAppEscape({ userAgent: INSTAGRAM_ANDROID, href: "https://acttub.com/app?ib=1" }),
    [],
  );
  assert.deepEqual(
    runInAppEscape({ userAgent: INSTAGRAM_ANDROID, href: "https://acttub.com/app", webdriver: true }),
    [],
  );
});

test("루트 레이아웃은 한국어 문서에 자식 화면을 싣는다", () => {
  const markup = renderToStaticMarkup(
    react.createElement(RootLayout, null, react.createElement("p", null, "본문")),
  );

  assert.match(markup, /^<html lang="ko"/);
  assert.match(markup, /<p>본문<\/p><\/body><\/html>$/);
  assert.equal(rootMetadata.metadataBase.href, "https://acttub.com/");
});

test("마지막 오류 화면은 에러를 Sentry 에 보내고, 다시 열기를 누르면 reset 을 부른다", () => {
  let resets = 0;
  const error = new Error("레이아웃이 깨졌다");
  // <html>·<body> 를 직접 그리는 화면이라 문서 자체에 그린다.
  render(react.createElement(GlobalError, { error, reset: () => (resets += 1) }), {
    container: window.document,
  });

  assert.deepEqual(captured, ["레이아웃이 깨졌다"]);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "화면을 불러오지 못했어요");
  fireEvent.click(screen.getByRole("button", { name: "다시 열기" }));
  assert.equal(resets, 1);
});

test("404 는 색인하지 않고 다시 시작할 링크를 준다", () => {
  render(react.createElement(NotFound));

  assert.equal(notFoundMetadata.title, "페이지를 찾을 수 없어요");
  assert.deepEqual(notFoundMetadata.robots, { index: false, follow: false });
  assert.deepEqual(
    screen.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
    [
      ["홈 →", "/"],
      ["앱 다운로드 →", "/app"],
      ["AI 연기 코칭 →", "/ai-acting-coaching"],
      ["연기 코칭 안내 →", "/acting-coaching"],
      ["블로그 →", "/blog"],
    ],
  );
});

test("글꼴 시트는 한 번만 붙이고, 내려받기가 끝나면 모든 매체에 적용한다", () => {
  render(react.createElement(PretendardStylesheet));
  render(react.createElement(PretendardStylesheet));

  const sheets = window.document.head.querySelectorAll("#pretendard-dynamic-subset");
  assert.equal(sheets.length, 1);
  const [sheet] = sheets;
  assert.equal(sheet.getAttribute("href"), `/fonts/pretendard/${pretendardVersion}/pretendard.css`);
  assert.equal(sheet.media, "print");
  sheet.onload();
  assert.equal(sheet.media, "all");
});

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
const { version: pretendardVersion } = (
  await import("pretendard/package.json", { with: { type: "json" } })
).default;

afterEach(() => {
  cleanup();
  captured.length = 0;
});

/** 루트 레이아웃의 첫 인라인 스크립트(인앱 탈출)를 주어진 브라우저 상태에서 돌린다. */
function runInAppEscape({ userAgent, href, webdriver = false }) {
  const markup = renderToStaticMarkup(
    react.createElement(RootLayout, null, react.createElement("p", null, "본문")),
  );
  // 글꼴 preload 가 <head> 앞쪽으로 올라올 수 있어 <head> 바로 뒤가 아니라 첫 <script> 를 찾는다.
  const script = markup.match(/<head>(?:<link\b[^>]*>)*<script>([\s\S]*?)<\/script>/)[1];
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

test("글꼴 시트와 자주 쓰는 서브셋 미리 받기는 서버 렌더 <head> 에 실린다", () => {
  const fontRoot = `/fonts/pretendard/${pretendardVersion}`;
  for (const element of [
    react.createElement(RootLayout, null, react.createElement("p", null, "본문")),
    react.createElement(GlobalError, { error: new Error("레이아웃이 깨졌다"), reset: () => {} }),
  ]) {
    const head = renderToStaticMarkup(element).match(/<head>([\s\S]*?)<\/head>/)[1];
    // React 가 preload 를 <head> 앞쪽으로 끌어올릴 수 있어 태그 순서와 속성 순서는 보지 않는다.
    const links = [...head.matchAll(/<link\b([^>]*?)\/?>/g)].map(([, attributes]) =>
      Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
    );
    // 하이드레이션 뒤에 붙이던 media=print 우회는 첫 페인트를 시스템 글꼴로 내보냈다.
    const sheets = links.filter((link) => link.rel === "stylesheet");
    assert.deepEqual(sheets.map((link) => link.href), [`${fontRoot}/pretendard.css`]);
    assert.equal(sheets[0].media, undefined);
    const preloads = links.filter((link) => link.rel === "preload");
    assert.deepEqual(
      preloads.map((link) => link.href).sort(),
      [89, 90, 91].map((subset) => `${fontRoot}/woff2-dynamic-subset/PretendardVariable.subset.${subset}.woff2`),
    );
    for (const link of preloads) {
      assert.equal(link.as, "font");
      assert.equal(link.type, "font/woff2");
      assert.equal(link.crossorigin, "anonymous");
    }
  }
});

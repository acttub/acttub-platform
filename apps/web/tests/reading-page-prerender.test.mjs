// reading.session — 단계 페이지는 정적 프리렌더된다. 서버(window 없음)에서는 저장소를 읽지 않고 빈 틀만 그려,
// 하이드레이션 전 HTML 이 기기마다 달라지지 않게 한다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const stubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const replaced = new Set(["next/navigation", "next/link", "@/features/nav/app-rail"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const reads = [];
globalThis.sessionStorage = {
  getItem: (key) => {
    reads.push(key);
    return null;
  },
};

const React = await import("react");
const { renderToString } = await import("react-dom/server");
const { nav } = await import("./fixtures/reading-page-stubs.mjs");
const { SetupPage } = await import("../src/features/reading/pages/setup-page.tsx");
const { DonePage } = await import("../src/features/reading/pages/done-page.tsx");
const { MemorizePage } = await import("../src/features/reading/pages/memorize-page.tsx");

test("reading.session: 서버 렌더에서는 기기 저장소를 읽지 않고 글자 없는 빈 틀만 그린다", () => {
  assert.equal(typeof window, "undefined");
  for (const Page of [SetupPage, DonePage, MemorizePage]) {
    const html = renderToString(React.createElement(Page));
    assert.equal(html.replace(/<[^>]+>/g, ""), "");
  }
  assert.deepEqual(reads, []);
  assert.deepEqual(nav.replaced, []);
});

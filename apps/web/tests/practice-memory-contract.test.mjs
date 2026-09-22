import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import "./ts-module-loader.mjs";
import { mountProbe, react, window } from "./mount-probe.mjs";

// Next의 Node ESM 하위 경로만 확장한다. Link 자체는 실제 컴포넌트다.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/link" ? "next/link.js" : specifier, context);
} });
globalThis.self = window;
const { MemoryPanel } = await import("../src/features/memory/memory-panel.tsx");
const { setTokens, clearTokens } = await import("../src/lib/auth/token-store.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearTokens(); window.localStorage.clear(); });

test("현재 기억 응답의 작성자와 숨겨지지 않은 출처만 화면에 표시한다", async () => {
  setTokens({ access_token: "guest", refresh_token: "refresh" });
  globalThis.fetch = async (url) => {
    assert.equal(url, "/v2/me/memory");
    return new Response(JSON.stringify({ items: [
      { field: "goal", value: "내 목표", written_by_actor: true, source_practice_id: null, updated_at: "2026-09-21T00:00:00Z" },
      { field: "blockage", value: "말끝", written_by_actor: false, source_practice_id: "p1", updated_at: "2026-09-21T00:00:00Z" },
      { field: "speech_self", value: "차분하게", written_by_actor: false, source_practice_id: null, updated_at: "2026-09-21T00:00:00Z" },
    ] }), { headers: { "Content-Type": "application/json" } });
  };
  let probe;
  try {
    await react.act(async () => { probe = mountProbe(MemoryPanel); });
    assert.match(probe.text(), /내가 적은 값/);
    assert.match(probe.text(), /코치가 적음/);
    const links = [...window.document.querySelectorAll('a[href*="session="]')];
    assert.deepEqual(links.map((link) => link.getAttribute("href")), ["/home?session=p1"]);
  } finally { probe?.unmount(); }
});

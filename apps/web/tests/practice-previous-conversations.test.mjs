import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import "./ts-module-loader.mjs";
import { mountProbe, react, window } from "./mount-probe.mjs";
const { setTokens, clearTokens } = await import("../src/lib/auth/token-store.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearTokens(); });

test("이전 대화를 펼치면 해당 대화만 조회하고 답장 입력 없이 기록을 보여준다", async () => {
  const { PreviousConversations } = await import("../src/features/practice/previous-conversations.tsx");
  setTokens({ access_token: "guest", refresh_token: "refresh" });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.method]);
    return new Response(JSON.stringify({ id: "old", status: "closed", revision: 3,
      messages: [{ role: "actor", text: "이전 배우의 말", turn_index: 1 }, { role: "coach", text: "이전 질문", turn_index: 2 }] }),
      { headers: { "Content-Type": "application/json" } });
  };
  const Probe = () => react.createElement(PreviousConversations, { conversations: [{ id: "old", status: "closed", created_at: "2026-09-01T00:00:00Z" }] });
  const probe = mountProbe(Probe);
  try {
    assert.deepEqual(calls, []);
    await react.act(async () => { window.document.querySelector('button[aria-expanded="false"]').click(); });
    assert.deepEqual(calls, [["/v2/coach/conversations/old", "GET"]]);
    assert.match(probe.text(), /이전 배우의 말/);
    assert.match(probe.text(), /이전 질문/);
    assert.equal(window.document.querySelector("textarea,input"), null);
  } finally { probe.unmount(); }
});

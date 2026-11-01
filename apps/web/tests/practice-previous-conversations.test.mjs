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

const { cleanup, render, screen } = await import("@testing-library/react");
const { PreviousConversations } = await import("../src/features/practice/previous-conversations.tsx");

function conversationResponse(id, text) {
  return new Response(JSON.stringify({ id, status: "closed", revision: 2,
    messages: [{ role: "coach", text: `${text} 코치`, turn_index: 2 }, { role: "actor", text: `${text} 배우`, turn_index: 1 }] }),
    { headers: { "Content-Type": "application/json" } });
}

const olds = [
  { id: "old-1", status: "closed", created_at: "2026-09-01T00:00:00Z" },
  { id: "old-2", status: "closed", created_at: "2026-09-02T00:00:00Z" },
];

test("이전 대화는 한 번에 하나만 펼치고, 다시 누르면 접는다", async () => {
  setTokens({ access_token: "guest", refresh_token: "refresh" });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return conversationResponse(String(url).split("/").at(-1), String(url).endsWith("old-1") ? "첫" : "둘째");
  };
  render(react.createElement(PreviousConversations, { conversations: olds }));
  try {
    assert.equal(screen.getByRole("heading", { name: "이전 대화" }).textContent, "이전 대화");
    await react.act(async () => screen.getByRole("button", { name: "이전 대화 1 보기" }).click());
    assert.deepEqual(screen.getAllByRole("listitem").map((item) => item.textContent), ["나첫 배우", "코치첫 코치"]);

    await react.act(async () => screen.getByRole("button", { name: "이전 대화 2 보기" }).click());
    assert.equal(screen.getByRole("button", { name: "이전 대화 1 보기" }).getAttribute("aria-expanded"), "false");
    assert.equal(screen.getByRole("button", { name: "이전 대화 2 접기" }).getAttribute("aria-expanded"), "true");
    assert.deepEqual(screen.getAllByRole("listitem").map((item) => item.textContent), ["나둘째 배우", "코치둘째 코치"]);

    await react.act(async () => screen.getByRole("button", { name: "이전 대화 2 접기" }).click());
    assert.equal(screen.queryByRole("listitem"), null);
    assert.equal(screen.getByRole("button", { name: "이전 대화 2 보기" }).getAttribute("aria-expanded"), "false");
    assert.deepEqual(calls, ["/v2/coach/conversations/old-1", "/v2/coach/conversations/old-2"]);
  } finally { cleanup(); }
});

test("이전 대화를 받는 동안은 불러오는 중이라고 알리고, 못 받으면 그 자리에 알린다", async () => {
  setTokens({ access_token: "guest", refresh_token: "refresh" });
  let answer;
  globalThis.fetch = () => new Promise((resolve) => { answer = resolve; });
  render(react.createElement(PreviousConversations, { conversations: olds.slice(0, 1) }));
  try {
    await react.act(async () => screen.getByRole("button", { name: "이전 대화 1 보기" }).click());
    assert.equal(screen.getByRole("status").textContent, "대화를 불러오고 있어요.");

    await react.act(async () => answer(new Response(JSON.stringify({ detail: "not_found" }),
      { status: 404, headers: { "Content-Type": "application/json" } })));
    assert.equal(screen.getByRole("alert").textContent, "대화를 불러오지 못했어요.");
    assert.equal(screen.queryByRole("status"), null);
  } finally { cleanup(); }
});

test("이전 대화가 없는 회차는 이전 대화 자리를 그리지 않는다", () => {
  const { container, rerender } = render(react.createElement(PreviousConversations, { conversations: olds.slice(0, 1) }));
  try {
    assert.equal(screen.getByRole("button").textContent, "이전 대화 1 보기");
    rerender(react.createElement(PreviousConversations, { conversations: [] }));
    assert.equal(container.textContent, "");
  } finally { cleanup(); }
});

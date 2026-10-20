// account.guest — 루트에 놓인 "옮겼어요" 안내. 평소에는 아무것도 그리지 않다가, 어떤 요청이든 서버가 이 게스트를
// guest_transferred 로 거절하면 뒤 화면을 막는 안내를 띄우고, 새로 시작은 들고 있던 화면을 버리는 하드 이동이다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TransferredNoticeHost } = await import("../src/features/transfer/transferred-notice.tsx");
const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  window.document.body.style.overflow = "auto";
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  clearTokens();
});

async function transferredByServer() {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "guest_transferred" }), { status: 403, headers: { "Content-Type": "application/json" } });
  await act(async () => {
    await apiFetch("/v2/practices").catch(() => undefined);
  });
}

test("account.guest: 옮겨졌다는 답이 오기 전에는 아무것도 그리지 않는다", () => {
  const view = render(h(TransferredNoticeHost));

  assert.equal(view.container.innerHTML, "");
  assert.equal(screen.queryByRole("alertdialog"), null);
});

test("account.guest: 서버가 guest_transferred 로 답하면 뒤 화면을 막는 안내를 띄우고 새로 시작에 초점을 둔다", async () => {
  render(h(TransferredNoticeHost));
  await transferredByServer();

  const dialog = screen.getByRole("alertdialog", { name: "옮겼어요" });
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(
    window.document.getElementById(dialog.getAttribute("aria-describedby")).textContent,
    "이 브라우저의 연습을 앱으로 옮겼어요. 이제 앱에서 이어서 볼 수 있어요.",
  );
  // 닫는 길은 없다. 나가는 길은 새로 시작 하나다.
  assert.deepEqual(screen.getAllByRole("button").map((button) => button.textContent), ["새로 시작"]);
  assert.equal(window.document.activeElement, screen.getByRole("button", { name: "새로 시작" }));
  assert.equal(window.document.body.style.overflow, "hidden");
});

test("account.guest: 새로 시작을 누르면 안내를 거두고 빈 연습 화면으로 하드 이동한다", async () => {
  render(h(TransferredNoticeHost));
  await transferredByServer();
  // jsdom 은 다른 문서로 가는 이동을 하지 않고 "Not implemented: navigation" 을 알린다. 그 알림이 하드 이동의 흔적이다.
  const reported = [];
  console.error = (...args) => reported.push(args.map(String).join(" "));

  fireEvent.click(screen.getByRole("button", { name: "새로 시작" }));

  assert.equal(screen.queryByRole("alertdialog"), null);
  assert.equal(window.document.body.style.overflow, "auto");
  assert.equal(reported.some((line) => line.includes("Not implemented: navigation")), true);
});

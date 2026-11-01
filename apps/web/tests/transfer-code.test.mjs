// 이관 코드(account.guest). 웹이 요청하면 서버가 여섯 자리 숫자를 만들어 준다 — 10분 유효,
// 한 번 쓰면 끝, 새로 받으면 이전 코드는 무효다. 서버는 해시만 저장하므로 코드는 응답에서만 보인다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { requestTransferCode } = await import(
  "../src/lib/api/v2/guest-transfer.ts"
);
const { errorMessage } = await import("../src/lib/api/v2/errors.ts");
const {
  formatRemaining,
  groupCode,
  issueTransferCode,
  remainingSeconds,
  transferCodeStatus,
} = await import("../src/features/transfer/transfer-code.ts");
const { clearTokens, hasGuestSession, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function codeResponse(code = "482913", expiresIn = 600) {
  return jsonResponse(
    { code, expires_in: expiresIn, expires_at: "2026-10-02T03:21:09.120000Z" },
    201,
  );
}

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.guest: 이관 코드는 게스트 토큰으로 POST /v2/guest/transfer-code 를 불러 받는다", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = {
      route: `${options.method} ${String(url)}`,
      authorization: new Headers(options.headers).get("Authorization"),
      body: options.body,
    };
    return codeResponse();
  };

  const issued = await requestTransferCode();

  assert.deepEqual(request, {
    route: "POST /v2/guest/transfer-code",
    authorization: "Bearer guest-access",
    body: undefined,
  });
  assert.equal(issued.code, "482913");
  assert.equal(issued.expires_in, 600);
});

test("account.guest: 게스트가 없으면 코드를 받으러 가지 않고, 코드를 받으려고 게스트를 만들지도 않는다", async () => {
  clearTokens();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options.method} ${String(url)}`);
    return codeResponse();
  };

  await assert.rejects(
    requestTransferCode(),
    (error) => error?.status === 401 && error?.code === "guest_session_required",
  );

  assert.deepEqual(calls, []);
  assert.equal(hasGuestSession(), false);
});

test("account.guest: 받은 코드는 받은 순간부터 expires_in 만큼 유효하다 — 서버 시각과 브라우저 시각을 견주지 않는다", () => {
  const issued = issueTransferCode(
    { code: "482913", expires_in: 600, expires_at: "1999-01-01T00:00:00Z" },
    1_000_000,
  );

  assert.equal(remainingSeconds(issued, 1_000_000), 600);
  assert.equal(remainingSeconds(issued, 1_000_000 + 1_500), 599);
  assert.equal(remainingSeconds(issued, 1_000_000 + 599_001), 1);
  assert.equal(remainingSeconds(issued, 1_000_000 + 600_000), 0);
  assert.equal(remainingSeconds(issued, 1_000_000 + 900_000), 0);
});

test("account.guest: 발급 10분 뒤에는 만료로 보이고 다시 받아야 한다", () => {
  const issued = issueTransferCode(
    { code: "482913", expires_in: 600, expires_at: "" },
    0,
  );

  assert.equal(transferCodeStatus(null, 0), "none");
  assert.equal(transferCodeStatus(issued, 599_000), "active");
  assert.equal(transferCodeStatus(issued, 600_000), "expired");
});

test("account.guest: 남은 시간은 분:초로, 코드는 세 자리씩 끊어 보여 준다", () => {
  assert.equal(formatRemaining(600), "10:00");
  assert.equal(formatRemaining(599), "9:59");
  assert.equal(formatRemaining(61), "1:01");
  assert.equal(formatRemaining(9), "0:09");
  assert.equal(formatRemaining(0), "0:00");
  assert.equal(groupCode("482913"), "482 913");
  assert.equal(groupCode("007001"), "007 001");
});

test("account.guest: 회원 토큰이면 403 guest_only, 너무 자주 받으면 429 — 둘 다 화면 문구로 돌려준다", async () => {
  const FALLBACK = "코드를 받지 못했어요. 다시 시도해 주세요.";
  async function rejection() {
    try {
      await requestTransferCode();
    } catch (error) {
      return error;
    }
    throw new Error("실패해야 하는 요청이 성공했다");
  }

  globalThis.fetch = async () => jsonResponse({ detail: "guest_only" }, 403);
  const guestOnly = await rejection();
  assert.equal(guestOnly.status, 403);
  assert.equal(guestOnly.code, "guest_only");
  // 코드 원문이 아니라 화면이 준 문구다.
  assert.equal(errorMessage(guestOnly, FALLBACK), FALLBACK);

  globalThis.fetch = async () => jsonResponse({ detail: "rate limit exceeded" }, 429);
  assert.equal(errorMessage(await rejection(), FALLBACK), "잠시 뒤 다시 시도해 주세요.");
});

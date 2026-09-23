import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { registerConsentPrompt } = await import(
  "../src/lib/api/v2/consent-prompt.ts"
);
const { errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { postIdempotent } = await import("../src/lib/api/v2/idempotency.ts");
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;
let unregisterPrompt = () => {};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function consentDocument(type, overrides = {}) {
  return {
    id: `${type}-document`,
    type,
    version: "2026-10-01",
    title: `${type} 문서`,
    body: `${type} 전문`,
    required: true,
    published_at: "2026-10-01T00:00:00.000000Z",
    ...overrides,
  };
}

function consentRequired(...types) {
  return jsonResponse(
    {
      detail: "consent_required",
      pending_consents: types.map((type) => consentDocument(type)),
    },
    403,
  );
}

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  unregisterPrompt();
  unregisterPrompt = () => {};
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.guest: 403 consent_required를 받으면 빠진 문서로 시트를 띄우고 결정 뒤 같은 요청을 다시 보낸다", async () => {
  const requests = [];
  const prompted = [];
  globalThis.fetch = async (url, options) => {
    requests.push({
      url: String(url),
      method: options.method,
      body: options.body,
      requestId: options.headers.get("X-Request-Id"),
    });
    return requests.length === 1
      ? consentRequired("terms", "privacy", "ai_analysis")
      : jsonResponse({ intent_id: "intent-1" }, 201);
  };
  unregisterPrompt = registerConsentPrompt(async (documents) => {
    prompted.push(documents.map((document) => document.type));
    return "decided";
  });

  const { data } = await apiFetch("/v2/videos/intents", {
    method: "POST",
    body: { filename: "take.mp4" },
    headers: { "X-Request-Id": "request-1" },
  });

  assert.deepEqual(data, { intent_id: "intent-1" });
  assert.deepEqual(prompted, [["terms", "privacy", "ai_analysis"]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test("account.guest: 시트를 닫으면 요청을 다시 보내지 않고 403 consent_required와 빠진 문서를 그대로 돌려준다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return consentRequired("terms", "privacy", "ai_analysis");
  };
  unregisterPrompt = registerConsentPrompt(async () => "dismissed");

  let caught;
  try {
    await apiFetch("/v2/videos/intents", { method: "POST", body: {} });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.status, 403);
  assert.equal(caught?.code, "consent_required");
  assert.equal(fetchCount, 1);
  assert.equal(
    errorMessage(caught, "기본 문구"),
    "동의해야 계속할 수 있어요. 다시 시도하면 동의 문서를 볼 수 있어요.",
  );
});

test("account.guest: 연습에 동의한 뒤에는 서버가 빠졌다고 알린 문서만 묻는다", async () => {
  const prompted = [];
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? consentRequired("ai_analysis")
      : jsonResponse({ ok: true });
  };
  unregisterPrompt = registerConsentPrompt(async (documents) => {
    prompted.push(documents.map((document) => document.type));
    return "decided";
  });

  await apiFetch("/v2/videos/intents", { method: "POST", body: {} });

  assert.deepEqual(prompted, [["ai_analysis"]]);
});

test("account.guest: 동시에 막힌 요청 둘은 시트 하나를 함께 기다리고 둘 다 다시 보낸다", async () => {
  let promptCount = 0;
  let decide;
  const decided = new Promise((resolve) => {
    decide = resolve;
  });
  let consented = false;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return consented
      ? jsonResponse({ ok: true })
      : consentRequired("terms", "privacy");
  };
  unregisterPrompt = registerConsentPrompt(async () => {
    promptCount += 1;
    await decided;
    consented = true;
    return "decided";
  });

  const both = Promise.all([
    apiFetch("/v2/scripts", { method: "POST", body: { title: "대본 1" } }),
    apiFetch("/v2/scripts", { method: "POST", body: { title: "대본 2" } }),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  decide();
  const results = await both;

  assert.equal(promptCount, 1);
  assert.equal(fetchCount, 4);
  assert.deepEqual(results.map((result) => result.data), [{ ok: true }, { ok: true }]);
});

test("account.consent: 다시 보낸 요청이 또 막히면(그 사이 새 판) 시트를 한 번 더 띄우고, 그래도 막히면 403을 돌려준다", async () => {
  let promptCount = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return consentRequired("terms");
  };
  unregisterPrompt = registerConsentPrompt(async () => {
    promptCount += 1;
    return "decided";
  });

  await assert.rejects(
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
    (error) => error?.status === 403 && error?.code === "consent_required",
  );

  assert.equal(promptCount, 2);
  assert.equal(fetchCount, 3);
});

test("account.guest: 시트가 떠 있지 않은 화면에서는 403 consent_required를 그대로 돌려준다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return consentRequired("terms");
  };

  await assert.rejects(
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
    (error) => error?.status === 403 && error?.code === "consent_required",
  );
  assert.equal(fetchCount, 1);
});

test("account.consent: consent_blocked 분기는 없다 — 시트를 띄우지도 다시 보내지도 않는다", async () => {
  let promptCount = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse({ detail: "consent_blocked" }, 403);
  };
  unregisterPrompt = registerConsentPrompt(async () => {
    promptCount += 1;
    return "decided";
  });

  await assert.rejects(
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
    (error) => error?.status === 403 && error?.code === "consent_blocked",
  );
  assert.equal(promptCount, 0);
  assert.equal(fetchCount, 1);
});

test("account.guest: 회원 전용 403 member_only에는 시트를 띄우지 않는다", async () => {
  let promptCount = 0;
  globalThis.fetch = async () => jsonResponse({ detail: "member_only" }, 403);
  unregisterPrompt = registerConsentPrompt(async () => {
    promptCount += 1;
    return "decided";
  });

  await assert.rejects(
    apiFetch("/v2/portfolio"),
    (error) => error?.status === 403 && error?.code === "member_only",
  );
  assert.equal(promptCount, 0);
});

test("account.guest: 하루 네 번째 분석(429 guest_daily_analysis_limit)은 기다렸다 다시 보내지 않고 안내 문구를 돌려준다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse({ detail: "guest_daily_analysis_limit" }, 429);
  };

  let caught;
  try {
    await postIdempotent("/v2/practices", { upload_intent_id: "intent-1" });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.status, 429);
  assert.equal(caught?.code, "guest_daily_analysis_limit");
  assert.equal(fetchCount, 1);
  assert.equal(
    errorMessage(caught, "기본 문구"),
    "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.",
  );
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { canAgree, openSheet, submitSheet } = await import(
  "../src/features/consent/consent-sheet-flow.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

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

const PRACTICE_DOCUMENTS = ["terms", "privacy", "ai_analysis"].map((type) =>
  consentDocument(type),
);

function startGuest(id = "guest-1") {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

/** POST /v2/consents 를 받아 적는 가짜 서버. `reply` 가 없으면 201 로 받아 준다. */
function recordConsents(reply = () => undefined) {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "/v2/consents");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    bodies.push(body);
    return (
      reply(body, bodies) ??
      jsonResponse(
        {
          id: `event-${bodies.length}`,
          document_id: body.document_id,
          action: body.action,
          occurred_at: "2026-10-02T03:11:09.120000Z",
        },
        201,
      )
    );
  };
  return bodies;
}

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  startGuest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

test("account.guest: 새 게스트의 첫 시트는 만 14세 이상 확인 줄을 누르기 전에는 동의 버튼이 꺼져 있다", () => {
  const sheet = openSheet(PRACTICE_DOCUMENTS);

  assert.equal(sheet.askAge, true);
  assert.equal(canAgree(sheet, false), false);
  assert.equal(canAgree(sheet, true), true);
});

test("account.guest: 확인하고 동의하면 문서마다 granted를 보내고 첫 제출에 age_confirmed를 싣는다", async () => {
  const bodies = recordConsents();
  const sheet = openSheet(PRACTICE_DOCUMENTS);

  const result = await submitSheet(sheet, true);

  assert.deepEqual(result, { kind: "decided" });
  assert.deepEqual(bodies, [
    { document_id: "terms-document", action: "granted", age_confirmed: true },
    { document_id: "privacy-document", action: "granted" },
    { document_id: "ai_analysis-document", action: "granted" },
  ]);
});

test("account.guest: 확인 줄을 누르지 않은 제출은 서버에 가지 않는다", async () => {
  const bodies = recordConsents();
  const sheet = openSheet(PRACTICE_DOCUMENTS);

  const result = await submitSheet(sheet, false);

  assert.deepEqual(result, { kind: "age_required" });
  assert.deepEqual(bodies, []);
});

test("account.guest: 리딩부터 시작해 둘에 동의한 게스트가 연습을 시작하면 AI 분석 동의 하나만, 확인 줄 없이 묻는다", async () => {
  recordConsents();
  await submitSheet(
    openSheet([consentDocument("terms"), consentDocument("privacy")]),
    true,
  );

  const bodies = recordConsents();
  const sheet = openSheet([consentDocument("ai_analysis")]);

  assert.equal(sheet.askAge, false);
  assert.deepEqual(
    sheet.documents.map((document) => document.type),
    ["ai_analysis"],
  );
  assert.equal(canAgree(sheet, false), true);
  assert.deepEqual(await submitSheet(sheet, false), { kind: "decided" });
  assert.deepEqual(bodies, [
    { document_id: "ai_analysis-document", action: "granted" },
  ]);
});

test("account.guest: 브라우저 저장소를 지워 새 게스트가 되면 확인 줄을 다시 묻는다", async () => {
  recordConsents();
  await submitSheet(openSheet(PRACTICE_DOCUMENTS), true);

  window.localStorage.clear();
  clearTokens();
  startGuest("guest-2");

  assert.equal(openSheet(PRACTICE_DOCUMENTS).askAge, true);
});

test("account.guest: 선택 문서는 게스트의 시트에 넣지 않는다", () => {
  const sheet = openSheet([
    ...PRACTICE_DOCUMENTS,
    consentDocument("retention", { required: false }),
  ]);

  assert.deepEqual(
    sheet.documents.map((document) => document.type),
    ["terms", "privacy", "ai_analysis"],
  );
});

test("account.guest: 서버가 확인 없는 동의 제출을 422로 거절하면 확인 줄을 다시 보여 준다", async () => {
  recordConsents();
  await submitSheet(
    openSheet([consentDocument("terms"), consentDocument("privacy")]),
    true,
  );
  recordConsents(() =>
    jsonResponse({ detail: "age_confirmation_required" }, 422),
  );

  const result = await submitSheet(
    openSheet([consentDocument("ai_analysis")]),
    false,
  );

  assert.deepEqual(result, { kind: "age_required" });
  assert.equal(openSheet([consentDocument("ai_analysis")]).askAge, true);
});

test("account.consent: 옛 판 문서 id(409)는 건너뛰고 끝낸다 — 다시 보낸 요청이 현재 판 목록을 받아 온다", async () => {
  const bodies = recordConsents((body) =>
    body.document_id === "privacy-document"
      ? jsonResponse({ detail: "consent_document_outdated" }, 409)
      : undefined,
  );

  const result = await submitSheet(openSheet(PRACTICE_DOCUMENTS), true);

  assert.deepEqual(result, { kind: "decided" });
  assert.equal(bodies.length, 3);
});

test("account.consent: 저장에 실패하면 시트를 닫지 않고 문구를 돌려주며, 다시 누르면 처음부터 보낸다(같은 결정 재전송은 200)", async () => {
  let failing = true;
  const bodies = recordConsents((body) =>
    failing && body.document_id === "privacy-document"
      ? jsonResponse({ detail: "internal_server_error" }, 500)
      : undefined,
  );
  const sheet = openSheet(PRACTICE_DOCUMENTS);

  const failed = await submitSheet(sheet, true);
  assert.equal(failed.kind, "failed");
  assert.equal(typeof failed.message, "string");

  failing = false;
  bodies.length = 0;
  assert.deepEqual(await submitSheet(sheet, true), { kind: "decided" });
  assert.deepEqual(
    bodies.map((body) => body.document_id),
    ["terms-document", "privacy-document", "ai_analysis-document"],
  );
});

test("account.consent: 동의 제출이 403 consent_required로 막혀도 시트를 겹쳐 띄우지 않는다", async () => {
  const { registerConsentPrompt } = await import(
    "../src/lib/api/v2/consent-prompt.ts"
  );
  let promptCount = 0;
  const unregister = registerConsentPrompt(async () => {
    promptCount += 1;
    return "decided";
  });
  recordConsents(() =>
    jsonResponse(
      { detail: "consent_required", pending_consents: PRACTICE_DOCUMENTS },
      403,
    ),
  );

  try {
    const result = await submitSheet(openSheet(PRACTICE_DOCUMENTS), true);
    assert.equal(result.kind, "failed");
    assert.equal(promptCount, 0);
  } finally {
    unregister();
  }
});

// 계측을 켤지는 서버의 동의 현황이 정한다(tests/analytics-consent.test.mjs). 시트는 그 판단에
// 쓸 것을 브라우저에 남기지 않는다 — 남기는 것은 나이 확인 하나뿐이다.
test("계측 I-6: 시트에서 privacy 문서에 동의해도 계측 판단용 기록을 localStorage 에 남기지 않는다", async () => {
  recordConsents();
  await submitSheet(openSheet(PRACTICE_DOCUMENTS), true);

  assert.deepEqual(
    Object.keys(window.localStorage)
      .filter((key) => !key.startsWith("acttub.guest.") || key.includes("privacy"))
      .sort(),
    [],
  );
  assert.equal(window.localStorage.getItem("acttub.guest.age_confirmed"), "guest-1");
});

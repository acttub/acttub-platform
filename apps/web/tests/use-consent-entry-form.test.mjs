import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount, react } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  ConsentEntryFormProbe,
  getAllowedEntries,
  resetAllowedEntries,
} = await import("./fixtures/consent-entry-form-probe.tsx");
const { clearConsentEntrySession } = await import(
  "../src/features/auth/consent-entry.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;
let probe;

function document(id, overrides = {}) {
  return {
    id,
    type: "terms",
    version: "v1",
    title: `문서 ${id}`,
    body: "본문",
    required: true,
    published_at: "2026-01-01T00:00:00Z",
    current_decision: null,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush() {
  await react.act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  clearTokens();
  clearConsentEntrySession();
  resetAllowedEntries();
  setTokens({ access_token: "access", refresh_token: "refresh" });
});

afterEach(() => {
  probe?.unmount();
  probe = undefined;
  globalThis.fetch = originalFetch;
  clearTokens();
  clearConsentEntrySession();
  resetAllowedEntries();
});

test("실제 동의 폼 상태는 부분 성공을 보존하고 최종 재확인만 다시 시도한다", async () => {
  const required = document("required");
  const optional = document("optional", {
    required: false,
    type: "ai_analysis",
  });
  const requests = [];
  let optionalAttempts = 0;
  let verificationAttempts = 0;
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/v2/consents/entry") {
      requests.push("GET:entry");
      verificationAttempts += 1;
      if (verificationAttempts === 1) {
        return jsonResponse({
          entry_status: "decision_required",
          documents: [required, optional],
          undecided_documents: [required, optional],
        });
      }
      if (verificationAttempts === 2) throw new TypeError("offline");
      return jsonResponse({
        entry_status: "allowed",
        documents: [],
        undecided_documents: [],
      });
    }
    if (path === "/v2/consents") {
      const body = JSON.parse(options.body);
      requests.push(`POST:${body.document_id}`);
      if (body.document_id === optional.id) {
        optionalAttempts += 1;
        if (optionalAttempts === 1) {
          return jsonResponse({ detail: "temporary_failure" }, 500);
        }
      }
      return jsonResponse({ id: `event-${body.document_id}` });
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  probe = mount(ConsentEntryFormProbe);
  await flush();
  assert.equal(probe.latest.consents.state, "ready");
  assert.equal(probe.latest.canSubmit, false);

  probe.act((form) => form.updateChoice(required.id, "granted"));
  probe.act((form) => form.updateChoice(optional.id, "declined"));
  assert.equal(probe.latest.canSubmit, true);

  await react.act(async () => probe.latest.submit());
  assert.deepEqual([...probe.latest.completedDocumentIds], [required.id]);
  assert.match(probe.latest.submitError, /1개 동의 항목/);

  await react.act(async () => probe.latest.submit());
  assert.equal(probe.latest.verificationPending, true);
  assert.deepEqual([...probe.latest.completedDocumentIds], [
    required.id,
    optional.id,
  ]);

  await react.act(async () => probe.latest.submit());
  assert.deepEqual(getAllowedEntries(), ["allowed"]);
  assert.deepEqual(requests, [
    "GET:entry",
    "POST:required",
    "POST:optional",
    "POST:optional",
    "GET:entry",
    "GET:entry",
  ]);
});

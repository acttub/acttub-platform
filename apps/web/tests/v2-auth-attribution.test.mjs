import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

class FakeStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const storage = new FakeStorage();
globalThis.window = {
  localStorage: storage,
  addEventListener() {},
};

const { login } = await import("../src/lib/api/v2/auth.ts");
const originalFetch = globalThis.fetch;
let firstSeenAt;

beforeEach(() => {
  firstSeenAt = new Date().toISOString();
  storage.values.clear();
  storage.setItem(
    "acttub.acquisition",
    JSON.stringify({
      utm_source: "stage",
      landing_path: "/login",
      first_seen_at: firstSeenAt,
    }),
  );
});

after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
});

test("로그인 요청에 가입 유입을 싣고 성공하면 저장값을 지운다", async () => {
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "bearer",
        expires_in: 1800,
        user: { id: "user-1", email: null, status: "active" },
        pending_consents: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await login("google", "provider-token");

  assert.deepEqual(requestBody, {
    provider: "google",
    id_token: "provider-token",
    signup_attribution: {
      utm_source: "stage",
      landing_path: "/login",
      first_seen_at: firstSeenAt,
    },
  });
  assert.equal(storage.getItem("acttub.acquisition"), null);
});

test("로그인이 실패하면 다음 시도를 위해 가입 유입을 유지한다", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "invalid_provider_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(login("google", "bad-token"));
  assert.notEqual(storage.getItem("acttub.acquisition"), null);
});

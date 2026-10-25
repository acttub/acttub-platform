// 웹 로그인 리뷰 반영(SOMA-834): 돌아갈 곳 우회 차단, 게스트 이관 실패 시 보관본 유지, 회원 만료 시 새 게스트를 만들지 않음.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
const target = new EventTarget();
globalThis.window = {
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  location: { origin: "https://acttub.com", search: "" },
  addEventListener: (...a) => target.addEventListener(...a),
  removeEventListener: (...a) => target.removeEventListener(...a),
  dispatchEvent: (e) => target.dispatchEvent(e),
};
process.env.NEXT_PUBLIC_API_BASE_URL = "";

await import("./ts-module-loader.mjs");
const { safeNext } = await import("../src/features/auth/login-providers.ts");
const carry = await import("../src/features/auth/carry-guest.ts");
const store = await import("../src/lib/auth/token-store.ts");
const { refreshAccessToken } = await import("../src/lib/auth/refresh.ts");
const { isLoginExpired } = await import("../src/lib/auth/login-expired.ts");

const json = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  store.clearTokens();
});

test("돌아갈 곳: 역슬래시·제어문자·다른 출처·스킴은 /account 로 바꾼다", () => {
  const origin = "https://acttub.com";
  assert.equal(safeNext("/reading?x=1#a", origin), "/reading?x=1#a");
  for (const bad of ["/\\evil.com", "/\t/evil.com", "/%09/evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)", "/\\/evil.com", ""]) {
    assert.equal(safeNext(bad, origin), "/account", bad);
  }
});

test("게스트 이관이 실패하면 보관본이 남고 다시 옮길 수 있다", async () => {
  store.setTokens({ access_token: "guest-a", refresh_token: "guest-r" });
  carry.backupGuestBeforeLogin();
  store.setMemberTokens({ access_token: "member-a", refresh_token: "member-r" }, { id: "u", email: null, status: "active" }, "google");

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v2/guest/transfer-code")) return json(201, { code: "123456", expires_in: 600 });
    return json(403, { detail: "profile_required" });
  };
  assert.equal(await carry.redeemGuestCarry(), "failed");
  assert.equal(carry.hasPendingCarry(), true);
  assert.equal(carry.takeCarryStatus(), "failed");

  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") });
    if (String(url).endsWith("/v2/guest/transfer-code")) return json(201, { code: "654321", expires_in: 600 });
    return json(201, { moved: true });
  };
  assert.equal(await carry.redeemGuestCarry(), "moved");
  assert.equal(carry.hasPendingCarry(), false);
  assert.equal(seen[0].auth, "Bearer guest-a");
  assert.equal(seen[1].auth, "Bearer member-a");
});

test("회원의 갱신이 거절되면 새 게스트를 만들지 않고 로그인 만료를 알린다", async () => {
  store.setMemberTokens({ access_token: "member-a", refresh_token: "member-r" }, { id: "u", email: null, status: "active" }, "google");
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return json(401, { detail: "invalid_refresh_token" });
  };
  await assert.rejects(refreshAccessToken("member-a"));
  assert.equal(store.isMemberSession(), false);
  assert.equal(store.getRefreshToken(), null);
  assert.equal(isLoginExpired(), true);
  assert.equal(calls.some((u) => u.endsWith("/v2/auth/guest")), false);
});

test("토큰을 바꾸면 같은 탭에도 알린다", () => {
  let n = 0;
  const off = store.subscribeAuthChange(() => { n += 1; });
  store.setTokens({ access_token: "a", refresh_token: "r" });
  store.clearTokens();
  off();
  assert.equal(n, 2);
});

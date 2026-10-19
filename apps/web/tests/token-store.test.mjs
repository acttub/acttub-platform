// 브라우저 저장소에 놓인 게스트 토큰(account.guest). 모듈을 불러오는 순간 0.1.0 이전 키를 지우고,
// 다른 탭이 토큰을 돌리거나 게스트를 끝내면 storage 이벤트로 메모리 캐시를 맞춘다.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { window } from "./dom-setup.mjs";
import "./ts-module-loader.mjs";

const storage = window.localStorage;
// 0.1.0 이전 웹 로그인이 남긴 키와 이 앱과 무관한 키. 모듈을 불러오기 전에 심는다.
storage.setItem("acttub.access_token", "old-member-access");
storage.setItem("acttub.refresh_token", "old-member-refresh");
storage.setItem("acttub.user", '{"id":"member"}');
storage.setItem("acttub.pending_consents", "[]");
storage.setItem("acttub.accepted_privacy_version", "v1");
storage.setItem("acttub.display_names", "{}");
storage.setItem("other.app.key", "남겨 둔다");

const { clearTokens, getAccessToken, getRefreshToken, getStoredUser, hasGuestSession, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

function otherTabWrites(key, newValue) {
  if (newValue === null) storage.removeItem(key);
  else storage.setItem(key, newValue);
  window.dispatchEvent(new window.StorageEvent("storage", { key, newValue }));
}

beforeEach(() => {
  clearTokens();
});

test("불러오는 순간 0.1.0 이전 로그인 키만 지운다", () => {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
  assert.deepEqual(keys, ["other.app.key"]);
  assert.equal(storage.getItem("other.app.key"), "남겨 둔다");
});

test("토큰과 게스트 정보를 저장소에 남기고 지울 때 셋 다 지운다", () => {
  const user = { id: "guest-1", email: null, status: "active" };
  setTokens({ access_token: "a-1", refresh_token: "r-1" }, user);

  assert.equal(storage.getItem("acttub.guest.access_token"), "a-1");
  assert.equal(storage.getItem("acttub.guest.refresh_token"), "r-1");
  assert.deepEqual(getStoredUser(), user);
  assert.equal(hasGuestSession(), true);

  clearTokens();

  assert.equal(storage.getItem("acttub.guest.access_token"), null);
  assert.equal(storage.getItem("acttub.guest.refresh_token"), null);
  assert.equal(storage.getItem("acttub.guest.user"), null);
  assert.equal(getStoredUser(), null);
  assert.equal(hasGuestSession(), false);
});

test("저장된 게스트 정보가 깨져 있으면 없는 것으로 본다", () => {
  storage.setItem("acttub.guest.user", "{깨진 JSON");
  assert.equal(getStoredUser(), null);
});

test("다른 탭이 토큰을 돌리면 이 탭도 새 토큰을 쓴다", () => {
  setTokens({ access_token: "a-1", refresh_token: "r-1" });

  otherTabWrites("acttub.guest.access_token", "a-2");
  otherTabWrites("acttub.guest.refresh_token", "r-2");

  assert.equal(getAccessToken(), "a-2");
  assert.equal(getRefreshToken(), "r-2");
});

test("다른 탭이 게스트를 끝내면 이 탭에도 게스트가 없다", () => {
  setTokens({ access_token: "a-1", refresh_token: "r-1" });

  otherTabWrites("acttub.guest.access_token", null);
  otherTabWrites("acttub.guest.refresh_token", null);

  assert.equal(getAccessToken(), null);
  assert.equal(hasGuestSession(), false);
});

test("다른 탭이 무관한 키를 쓰면 이 탭의 토큰은 그대로다", () => {
  setTokens({ access_token: "a-1", refresh_token: "r-1" });

  otherTabWrites("other.app.key", "바뀜");

  assert.equal(getAccessToken(), "a-1");
  assert.equal(getRefreshToken(), "r-1");
});

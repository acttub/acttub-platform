// 게스트의 "만 14세 이상이에요" 확인 기록(account.guest). 게스트 id 에 묶어 이 브라우저에만 두고,
// 저장소를 쓸 수 없으면 다시 묻는 쪽(안전한 쪽)으로 실패한다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

const { clearAgeConfirmed, markAgeConfirmed, needsAgeConfirmation } = await import(
  "../src/features/consent/guest-consent-state.ts"
);
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const AGE_KEY = "acttub.guest.age_confirmed";
const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
const realStorage = window.localStorage;

function startGuest(id) {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

/** 게스트 토큰은 읽히지만 나이 확인 칸을 읽고 쓰는 일만 실패하는 저장소. */
function useStorageFailingOn(method) {
  const failing = {
    getItem: (key) => {
      if (method === "getItem" && key === AGE_KEY) throw new Error("SecurityError");
      return realStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (method === "setItem" && key === AGE_KEY) throw new Error("QuotaExceededError");
      realStorage.setItem(key, value);
    },
    removeItem: (key) => {
      if (method === "removeItem" && key === AGE_KEY) throw new Error("SecurityError");
      realStorage.removeItem(key);
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => failing });
}

beforeEach(() => {
  realStorage.clear();
  clearTokens();
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", storageDescriptor);
  clearTokens();
  realStorage.clear();
});

test("account.guest: 확인한 게스트에게는 다시 묻지 않고, 다른 게스트로 바뀌면 다시 묻는다", () => {
  startGuest("guest-1");
  assert.equal(needsAgeConfirmation(), true);

  markAgeConfirmed();
  assert.equal(realStorage.getItem(AGE_KEY), "guest-1");
  assert.equal(needsAgeConfirmation(), false);

  startGuest("guest-2");
  assert.equal(needsAgeConfirmation(), true);
});

test("account.guest: 게스트가 없으면 늘 묻고, 확인을 기록하지도 않는다", () => {
  assert.equal(needsAgeConfirmation(), true);

  markAgeConfirmed();

  assert.equal(realStorage.getItem(AGE_KEY), null);
});

test("account.guest: 토큰은 있어도 게스트 id 를 모르면 묻고, 확인을 기록하지 않는다", () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });

  assert.equal(needsAgeConfirmation(), true);
  markAgeConfirmed();

  assert.equal(realStorage.getItem(AGE_KEY), null);
});

test("account.guest: 확인 기록을 지우면 같은 게스트에게도 다시 묻는다", () => {
  startGuest("guest-1");
  markAgeConfirmed();

  clearAgeConfirmed();

  assert.equal(realStorage.getItem(AGE_KEY), null);
  assert.equal(needsAgeConfirmation(), true);
});

test("account.guest: 확인 기록을 읽을 수 없으면 다시 묻는다", () => {
  startGuest("guest-1");
  realStorage.setItem(AGE_KEY, "guest-1");
  useStorageFailingOn("getItem");

  assert.equal(needsAgeConfirmation(), true);
});

test("account.guest: 확인 기록을 쓸 수 없어도 오류 없이 넘어가고 다음 시트에서 다시 묻는다", () => {
  startGuest("guest-1");
  useStorageFailingOn("setItem");

  markAgeConfirmed();

  assert.equal(realStorage.getItem(AGE_KEY), null);
  assert.equal(needsAgeConfirmation(), true);
});

test("account.guest: 확인 기록을 지울 수 없어도 오류 없이 넘어간다", () => {
  startGuest("guest-1");
  realStorage.setItem(AGE_KEY, "guest-1");
  useStorageFailingOn("removeItem");

  clearAgeConfirmed();

  assert.equal(realStorage.getItem(AGE_KEY), "guest-1");
});

test("account.guest: 저장소 자체에 닿을 수 없으면 지우기는 아무 일도 하지 않는다", () => {
  realStorage.setItem(AGE_KEY, "guest-1");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("SecurityError");
    },
  });

  clearAgeConfirmed();

  Object.defineProperty(window, "localStorage", storageDescriptor);
  assert.equal(realStorage.getItem(AGE_KEY), "guest-1");
});

test("정적 프리렌더(window 없음)에서는 저장소를 건드리지 않고 확인이 필요하다고 답한다", () => {
  realStorage.setItem(AGE_KEY, "guest-1");
  const saved = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(needsAgeConfirmation(), true);
    clearAgeConfirmed();
  } finally {
    globalThis.window = saved;
  }
  assert.equal(realStorage.getItem(AGE_KEY), "guest-1");
});

// 운영 유입 비교용 최초 웹 UTM(ANALYTICS.md 「운영 유입 비교용 최초 웹 UTM」)의 나머지 갈래.
// 고장 난 저장소, 계정 경계, 전송 중 멈춤을 가짜 의존성으로 돌려 본다. 실제 브라우저에 붙은
// 모듈 손잡이는 web-attribution-browser.test.mjs 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

const { createWebAttributionController, webAttributionQuery } = await import(
  "../src/lib/analytics/web-attribution.ts"
);
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const PENDING_KEY = "acttub.web_attribution.pending";

class MemorySessionStore {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

/** 브라우저가 sessionStorage 를 막은 경우. 읽기·쓰기·지우기가 모두 던진다. */
const brokenStore = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

function startGuest(id) {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

function fixture({ send, store = new MemorySessionStore(), userId = () => "guest-new" }) {
  const sent = [];
  const stripped = [];
  const controller = createWebAttributionController({
    send: async (request, options) => {
      sent.push(request);
      return send?.(request, options);
    },
    currentUserId: userId,
    sessionStore: () => store,
    stripCurrentUrl: () => stripped.push(true),
  });
  return { controller, sent, stripped, store };
}

/** 이번 문서에서 새 게스트가 생긴 입장. 후보가 그 게스트 id 에 묶인다. */
function newGuestEntry(controller, search = "?utm_source=instagram&utm_medium=paid_social") {
  controller.captureInitial(search, false);
  startGuest("guest-new");
  controller.guestStarted("guest-new");
}

function storePending(store, value) {
  store.setItem(PENDING_KEY, typeof value === "string" ? value : JSON.stringify(value));
}

beforeEach(() => {
  clearTokens();
  window.localStorage.clear();
});

afterEach(() => {
  clearTokens();
  window.localStorage.clear();
});

test("utm_source 가 없는 주소는 내부 이동에 싣지 않는다", () => {
  assert.equal(webAttributionQuery(""), "");
  assert.equal(webAttributionQuery("?utm_medium=paid_social&utm_campaign=launch"), "");
});

for (const [label, pending] of [
  ["JSON 이 아닌 값", "{broken"],
  ["안전하지 않은 channel", { userId: "guest-new", request: { channel: "paid social" } }],
  ["문자열이 아닌 선택값", { userId: "guest-new", request: { channel: "instagram", medium: 7 } }],
  ["안전하지 않은 선택값", { userId: "guest-new", request: { channel: "instagram", term: "a b" } }],
  ["객체가 아닌 요청", { userId: "guest-new", request: "instagram" }],
  ["userId 없는 요청", { request: { channel: "instagram" } }],
]) {
  test(`reload 뒤 pending 이 ${label}이면 보내지 않고 저장 상태와 URL 을 폐기한다`, async () => {
    startGuest("guest-new");
    const { controller, sent, stripped, store } = fixture({});
    storePending(store, pending);
    controller.captureInitial("", true);

    assert.equal(await controller.activate("guest-new"), false);
    assert.deepEqual(sent, []);
    assert.equal(store.getItem(PENDING_KEY), null);
    assert.deepEqual(stripped, [true]);
  });
}

test("reload 로 복원한 pending 은 보내기 전까지 내부 이동에 같은 UTM 을 고정 순서로 싣는다", async () => {
  startGuest("guest-new");
  const store = new MemorySessionStore();
  const restored = fixture({ store, send: () => Promise.reject(new TypeError("offline")) });
  storePending(store, {
    userId: "guest-new",
    request: {
      channel: "instagram",
      medium: "paid_social",
      campaign: "launch",
      content: "reel_7",
      term: "actor",
    },
  });
  restored.controller.captureInitial("", true);

  assert.equal(await restored.controller.activate("guest-new"), false);
  assert.deepEqual(restored.sent, [
    { channel: "instagram", medium: "paid_social", campaign: "launch", content: "reel_7", term: "actor" },
  ]);
  assert.equal(
    restored.controller.preservePath("/home#note"),
    "/home?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch" +
      "&utm_term=actor&utm_content=reel_7#note",
  );
});

test("처음 연 주소만 후보로 읽고, 같은 문서의 다음 주소는 후보를 바꾸지 않는다", () => {
  const { controller } = fixture({});
  controller.captureInitial("?utm_source=instagram", false);

  controller.captureInitial("?utm_source=naver&utm_campaign=retarget", false);

  assert.equal(controller.preservePath("/home"), "/home?utm_source=instagram");
});

test("sessionStorage 를 쓸 수 없어도 이번 문서의 메모리 후보로 한 번 보내고 끝낸다", async () => {
  const { controller, sent, stripped } = fixture({ store: brokenStore });
  newGuestEntry(controller);

  assert.equal(await controller.activate("guest-new"), true);
  assert.deepEqual(sent, [{ channel: "instagram", medium: "paid_social" }]);
  assert.deepEqual(stripped, [true]);
});

test("sessionStorage 가 아예 없어도 메모리 후보로 보낸다", async () => {
  const { controller, sent } = fixture({ store: null });
  newGuestEntry(controller);

  assert.equal(await controller.activate("guest-new"), true);
  assert.deepEqual(sent, [{ channel: "instagram", medium: "paid_social" }]);
});

test("게스트 토큰이 없거나 동의한 user id 가 지금 게스트와 다르면 보내지 않고 폐기한다", async () => {
  const noGuest = fixture({});
  noGuest.controller.captureInitial("?utm_source=instagram", false);
  noGuest.controller.guestStarted("guest-new");
  assert.equal(await noGuest.controller.activate("guest-new"), false);

  startGuest("guest-new");
  const mismatch = fixture({ userId: () => "guest-other" });
  newGuestEntry(mismatch.controller);
  assert.equal(await mismatch.controller.activate("guest-new"), false);

  for (const { controller, sent, stripped } of [noGuest, mismatch]) {
    assert.deepEqual(sent, []);
    assert.deepEqual(stripped, [true]);
    assert.equal(controller.preservePath("/home"), "/home");
    // 폐기한 뒤에는 새 게스트 시작도, 다시 켜는 것도 후보를 되살리지 못한다.
    controller.guestStarted("guest-new");
    assert.equal(await controller.activate("guest-new"), false);
    assert.deepEqual(sent, []);
  }
});

test("한 문서에서 게스트 시작이 두 번이면 계정 경계로 보고 후보를 폐기한다", async () => {
  const { controller, sent, stripped } = fixture({});
  newGuestEntry(controller);

  controller.guestStarted("guest-second");

  assert.deepEqual(stripped, [true]);
  assert.equal(controller.preservePath("/home"), "/home");
  assert.equal(await controller.activate("guest-new"), false);
  assert.deepEqual(sent, []);
});

test("한 번 저장을 끝낸 뒤 다른 게스트로 켜지면 경계로 보고 다시 보내지 않는다", async () => {
  let current = "guest-new";
  const { controller, sent, stripped } = fixture({ userId: () => current });
  newGuestEntry(controller);
  assert.equal(await controller.activate("guest-new"), true);

  startGuest("guest-next");
  current = "guest-next";
  assert.equal(await controller.activate("guest-next"), false);

  assert.equal(sent.length, 1);
  assert.deepEqual(stripped, [true, true]);
  // 끝낸 뒤의 새 시작도 경계다.
  controller.guestStarted("guest-next");
  assert.equal(await controller.activate("guest-next"), false);
  assert.equal(sent.length, 1);
});

test("저장한 pending 이 다른 게스트의 것으로 바뀌어 있으면 이번 후보를 그 게스트에 붙이지 않는다", async () => {
  const store = new MemorySessionStore();
  let current = "guest-new";
  const { controller, sent, stripped } = fixture({
    store,
    userId: () => current,
    send: () => Promise.reject(new TypeError("offline")),
  });
  newGuestEntry(controller);
  assert.equal(await controller.activate("guest-new"), false);

  storePending(store, { userId: "guest-other", request: { channel: "naver" } });
  startGuest("guest-other");
  current = "guest-other";

  assert.equal(await controller.activate("guest-other"), false);
  assert.equal(sent.length, 1);
  assert.equal(store.getItem(PENDING_KEY), null);
  assert.deepEqual(stripped, [true]);
});

test("동의 재확인으로 멈추면 늦게 온 성공도 끝난 것으로 치지 않고, 다시 켜면 같은 후보를 보낸다", async () => {
  let finish;
  const { controller, sent, stripped, store } = fixture({
    send: () => new Promise((resolve) => { finish = resolve; }),
  });
  newGuestEntry(controller);

  const first = controller.activate("guest-new");
  controller.pause();
  finish();

  assert.equal(await first, false);
  assert.deepEqual(stripped, []);
  assert.equal(
    controller.preservePath("/home"),
    "/home?utm_source=instagram&utm_medium=paid_social",
  );
  assert.deepEqual(JSON.parse(store.getItem(PENDING_KEY)), {
    userId: "guest-new",
    request: { channel: "instagram", medium: "paid_social" },
  });

  const second = controller.activate("guest-new");
  finish();
  assert.equal(await second, true);
  assert.equal(sent.length, 2);
  assert.equal(store.getItem(PENDING_KEY), null);
});

test("멈춘 뒤 실패로 끝난 전송은 다음 시도를 막지 않는다", async () => {
  let fail;
  let succeed = false;
  const { controller, sent } = fixture({
    send: () =>
      succeed ? Promise.resolve() : new Promise((_resolve, reject) => { fail = reject; }),
  });
  newGuestEntry(controller);

  const first = controller.activate("guest-new");
  controller.pause();
  fail(new TypeError("offline"));
  assert.equal(await first, false);

  succeed = true;
  assert.equal(await controller.activate("guest-new"), true);
  assert.equal(sent.length, 2);
});

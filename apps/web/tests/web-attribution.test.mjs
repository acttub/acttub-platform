import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  createWebAttributionController,
  preserveWebAttributionFromSearch,
  webAttributionFromSearch,
  webAttributionQuery,
} = await import("../src/lib/analytics/web-attribution.ts");
const { putWebAttribution } = await import(
  "../src/lib/api/v2/web-attribution.ts"
);
const { createAnalyticsConsentGate } = await import(
  "../src/features/consent/analytics-consent.ts"
);
const { createAnalyticsMeasurementSwitch } = await import(
  "../src/features/analytics/measurement-switch.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

class MemorySessionStore {
  values = new Map();
  writes = [];

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.writes.push({ key, value });
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function startGuest(id) {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

function controllerFixture({ send, currentUserId, store = new MemorySessionStore() }) {
  const stripped = [];
  let storeReads = 0;
  const controller = createWebAttributionController({
    send,
    currentUserId,
    sessionStore: () => {
      storeReads += 1;
      return store;
    },
    stripCurrentUrl: () => stripped.push(true),
  });
  return { controller, store, stripped, get storeReads() { return storeReads; } };
}

beforeEach(() => {
  clearTokens();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("실제 URL에서 안전한 UTM만 서버 요청으로 바꾸고 source가 없으면 추정하지 않는다", () => {
  assert.deepEqual(
    webAttributionFromSearch(
      "?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch" +
        "&utm_content=reel_7&utm_term=actor&utm_id=meta_42" +
        "&fbclid=click&email=actor%40example.com",
    ),
    {
      channel: "instagram",
      medium: "paid_social",
      campaign: "launch",
      content: "reel_7",
      term: "actor",
    },
  );
  assert.equal(
    webAttributionFromSearch("?utm_medium=paid_social&utm_campaign=launch"),
    null,
  );
  assert.equal(webAttributionFromSearch("?utm_source=paid%20social"), null);
  assert.equal(webAttributionFromSearch("?utm_source=actor%40mail"), null);
});

test("내부 이동에는 source가 있는 안전 UTM만 보존하며 기존 쿼리와 함께 둔다", () => {
  const search =
    "?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch" +
    "&utm_id=meta_42&utm_content=reel_7&gclid=click";
  assert.equal(
    webAttributionQuery(search),
    "?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch" +
      "&utm_id=meta_42&utm_content=reel_7",
  );
  assert.equal(
    preserveWebAttributionFromSearch("/home?session=practice-1", search),
    "/home?session=practice-1&utm_source=instagram&utm_medium=paid_social" +
      "&utm_campaign=launch&utm_id=meta_42&utm_content=reel_7",
  );
  assert.equal(
    preserveWebAttributionFromSearch(
      "/home",
      "?utm_medium=paid_social&utm_campaign=launch",
    ),
    "/home",
  );
});

test("privacy 동의 전에는 UTM을 메모리와 안전 URL로만 이어 두고 저장소나 서버를 쓰지 않는다", () => {
  const sent = [];
  const fixture = controllerFixture({
    send: async (request) => sent.push(request),
    currentUserId: () => null,
  });

  fixture.controller.captureInitial(
    "?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42",
    false,
  );

  assert.equal(fixture.storeReads, 0);
  assert.deepEqual(fixture.store.writes, []);
  assert.deepEqual(sent, []);
  assert.equal(
    fixture.controller.preservePath("/home"),
    "/home?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42",
  );
});

test("이번 문서에서 새로 만든 guest id와 privacy 동의가 모두 맞을 때만 한 번 저장한다", async () => {
  let activeUserId = null;
  const sent = [];
  const fixture = controllerFixture({
    send: async (request) => sent.push(request),
    currentUserId: () => activeUserId,
  });
  fixture.controller.captureInitial(
    "?utm_source=instagram&utm_medium=paid_social&utm_campaign=launch",
    false,
  );

  activeUserId = "guest-new";
  startGuest(activeUserId);
  fixture.controller.guestStarted(activeUserId);

  assert.equal(await fixture.controller.activate(activeUserId), true);
  assert.deepEqual(sent, [
    { channel: "instagram", medium: "paid_social", campaign: "launch" },
  ]);
  assert.equal(fixture.store.values.size, 0);
  assert.deepEqual(fixture.stripped, [true]);
  assert.equal(fixture.controller.preservePath("/home"), "/home");
  assert.equal(await fixture.controller.activate(activeUserId), false);
  assert.equal(sent.length, 1);
});

test("최초 진입 때 이미 있던 guest의 광고 UTM은 과거 가입 출처로 저장하지 않는다", async () => {
  const activeUserId = "guest-existing";
  startGuest(activeUserId);
  const sent = [];
  const fixture = controllerFixture({
    send: async (request) => sent.push(request),
    currentUserId: () => activeUserId,
  });

  fixture.controller.captureInitial(
    "?utm_source=instagram&utm_medium=paid_social",
    true,
  );

  assert.equal(await fixture.controller.activate(activeUserId), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(fixture.store.writes, []);
});

test("새 guest 시작 이벤트가 없으면 현재 URL 후보를 기존 계정에 붙이지 않고 폐기한다", async () => {
  const activeUserId = "guest-restored";
  startGuest(activeUserId);
  const sent = [];
  const fixture = controllerFixture({
    send: async (request) => sent.push(request),
    currentUserId: () => activeUserId,
  });
  fixture.controller.captureInitial("?utm_source=instagram", false);

  assert.equal(await fixture.controller.activate(activeUserId), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(fixture.stripped, [true]);
});

test("전송 오류 뒤 reload는 동의 후 같은 userId에 바인딩한 pending만 복원한다", async () => {
  const activeUserId = "guest-new";
  startGuest(activeUserId);
  const store = new MemorySessionStore();
  const first = controllerFixture({
    store,
    currentUserId: () => activeUserId,
    send: async () => {
      throw new TypeError("offline");
    },
  });
  first.controller.captureInitial(
    "?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42",
    false,
  );
  first.controller.guestStarted(activeUserId);

  assert.equal(await first.controller.activate(activeUserId), false);
  assert.equal(store.writes.length, 1);
  assert.deepEqual(JSON.parse([...store.values.values()][0]), {
    userId: activeUserId,
    request: { channel: "instagram", medium: "paid_social" },
  });

  const retried = [];
  const afterReload = controllerFixture({
    store,
    currentUserId: () => activeUserId,
    send: async (request) => retried.push(request),
  });
  // reload 시점에는 이미 guest가 있으므로 URL은 신규 후보로 캡처하지 않는다.
  afterReload.controller.captureInitial("", true);

  assert.equal(await afterReload.controller.activate(activeUserId), true);
  assert.deepEqual(retried, [
    { channel: "instagram", medium: "paid_social" },
  ]);
  assert.equal(store.values.size, 0);
});

test("pending의 userId가 현재 guest와 다르면 새 계정으로 보내지 않고 모두 폐기한다", async () => {
  const store = new MemorySessionStore();
  store.setItem(
    "acttub.web_attribution.pending",
    JSON.stringify({
      userId: "guest-old",
      request: { channel: "instagram", medium: "paid_social" },
    }),
  );
  const activeUserId = "guest-new";
  startGuest(activeUserId);
  const sent = [];
  const fixture = controllerFixture({
    store,
    currentUserId: () => activeUserId,
    send: async (request) => sent.push(request),
  });
  fixture.controller.captureInitial("", true);

  assert.equal(await fixture.controller.activate(activeUserId), false);
  assert.deepEqual(sent, []);
  assert.equal(store.values.size, 0);
  assert.deepEqual(fixture.stripped, [true]);
});

test("게스트 종료 경계는 진행 요청을 취소하고 후보·pending·URL을 폐기한다", async () => {
  const activeUserId = "guest-new";
  startGuest(activeUserId);
  let aborted = false;
  const fixture = controllerFixture({
    currentUserId: () => activeUserId,
    send: (_request, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  });
  fixture.controller.captureInitial("?utm_source=instagram", false);
  fixture.controller.guestStarted(activeUserId);
  const pending = fixture.controller.activate(activeUserId);

  fixture.controller.invalidate();
  assert.equal(await pending, false);
  assert.equal(aborted, true);
  assert.equal(fixture.store.values.size, 0);
  assert.deepEqual(fixture.stripped, [true]);
  assert.equal(fixture.controller.preservePath("/home"), "/home");
});

test("서버 privacy granted 뒤에만 계측 식별과 귀속 저장을 차례로 켠다", async () => {
  startGuest("guest-new");
  const order = [];
  globalThis.fetch = async () => {
    order.push("privacy-check");
    return new Response(
      JSON.stringify({
        entry_status: "allowed",
        documents: [
          {
            type: "privacy",
            current_decision: "granted",
          },
        ],
        undecided_documents: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const measurement = createAnalyticsMeasurementSwitch({
    grant: () => order.push("ga-grant"),
    startAmplitude: () => order.push("amplitude-start"),
    setAnalyticsUser: (userId) => order.push(`ga-user:${userId}`),
    setAmplitudeUser: (userId) => order.push(`amplitude-user:${userId}`),
    activateAttribution: async (userId) => {
      order.push(`attribution:${userId}`);
      return true;
    },
    revoke: () => order.push("ga-revoke"),
    clearAnalyticsUser: () => order.push("ga-clear-user"),
    stopAmplitude: () => order.push("amplitude-stop"),
    pauseAttribution: () => order.push("attribution-pause"),
  });
  const gate = createAnalyticsConsentGate(measurement);

  assert.equal(await gate.check(), true);
  assert.deepEqual(order, [
    "ga-revoke",
    "ga-clear-user",
    "amplitude-stop",
    "attribution-pause",
    "privacy-check",
    "ga-grant",
    "amplitude-start",
    "ga-user:guest-new",
    "amplitude-user:guest-new",
    "attribution:guest-new",
  ]);
});

test("공용 v2 클라이언트가 PUT 204를 보내고 귀속 저장만으로 guest를 만들지 않는다", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  await assert.rejects(
    () => putWebAttribution({ channel: "instagram" }),
    (error) => error?.status === 401 && error?.code === "guest_session_required",
  );
  assert.deepEqual(calls, []);

  startGuest("guest-new");
  await putWebAttribution({
    channel: "instagram",
    medium: "paid_social",
    campaign: "launch",
    content: "reel_7",
    term: "actor",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v2/me/web-attribution");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(
    new Headers(calls[0].options.headers).get("Authorization"),
    "Bearer guest-new-access",
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    channel: "instagram",
    medium: "paid_social",
    campaign: "launch",
    content: "reel_7",
    term: "actor",
  });
});

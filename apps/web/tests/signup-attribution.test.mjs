import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  captureSignupAttribution,
  getSignupAttribution,
} = await import("../src/features/auth/signup-attribution.ts");

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

function withFakeBrowser(href, referrer, storage, run) {
  const url = new URL(href);
  globalThis.window = {
    location: {
      pathname: url.pathname,
      search: url.search,
    },
    localStorage: storage,
  };
  globalThis.document = { referrer };
  try {
    return run();
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test("두 번째 방문의 UTM이 first-touch를 덮어쓰지 않는다", () => {
  const storage = new FakeStorage();
  withFakeBrowser(
    "https://acttub.com/login?utm_source=stage&utm_campaign=first",
    "https://search.example/result?q=acting",
    storage,
    () => captureSignupAttribution(new Date("2026-07-01T00:00:00Z")),
  );
  withFakeBrowser(
    "https://acttub.com/?utm_source=voice&utm_campaign=second",
    "https://another.example/page",
    storage,
    () => captureSignupAttribution(new Date("2026-07-02T00:00:00Z")),
  );

  withFakeBrowser("https://acttub.com/", "", storage, () => {
    assert.deepEqual(getSignupAttribution(new Date("2026-07-02T00:00:00Z")), {
      utm_source: "stage",
      utm_campaign: "first",
      referrer_host: "search.example",
      landing_path: "/login",
      first_seen_at: "2026-07-01T00:00:00.000Z",
    });
  });
});

test("30일이 지난 저장값은 버리고 현재 방문을 새로 기록한다", () => {
  const storage = new FakeStorage();
  storage.setItem(
    "acttub.acquisition",
    JSON.stringify({
      utm_source: "stage",
      landing_path: "/old",
      first_seen_at: "2026-06-01T00:00:00.000Z",
    }),
  );

  withFakeBrowser(
    "https://acttub.com/login?utm_source=acti",
    "",
    storage,
    () => {
      captureSignupAttribution(new Date("2026-07-02T00:00:00Z"));
      assert.deepEqual(getSignupAttribution(new Date("2026-07-02T00:00:00Z")), {
        utm_source: "acti",
        landing_path: "/login",
        first_seen_at: "2026-07-02T00:00:00.000Z",
      });
    },
  );
});

test("가입 유입 허용목록 밖의 쿼리 파라미터는 저장하지 않는다", () => {
  const storage = new FakeStorage();
  withFakeBrowser(
    "https://acttub.com/?utm_source=worldcup&utm_id=private&gclid=click&fbclid=meta&next=/home",
    "",
    storage,
    () => {
      captureSignupAttribution(new Date("2026-07-01T00:00:00Z"));
      const attribution = getSignupAttribution(new Date("2026-07-01T00:00:00Z"));
      assert.equal(attribution?.utm_source, "worldcup");
      assert.deepEqual(Object.keys(attribution).sort(), [
        "first_seen_at",
        "landing_path",
        "utm_source",
      ]);
    },
  );
});

test("외부 referrer는 호스트만 남기고 자사 referrer는 남기지 않는다", () => {
  const externalStorage = new FakeStorage();
  withFakeBrowser(
    "https://acttub.com/login",
    "https://www.instagram.com/reel/abc?click=secret#part",
    externalStorage,
    () => {
      captureSignupAttribution(new Date("2026-07-01T00:00:00Z"));
      assert.equal(
        getSignupAttribution(new Date("2026-07-01T00:00:00Z"))?.referrer_host,
        "www.instagram.com",
      );
    },
  );

  const internalStorage = new FakeStorage();
  withFakeBrowser(
    "https://acttub.com/login",
    "https://voice.acttub.com/start?session=secret",
    internalStorage,
    () => {
      captureSignupAttribution(new Date("2026-07-01T00:00:00Z"));
      assert.equal(
        "referrer_host" in getSignupAttribution(new Date("2026-07-01T00:00:00Z")),
        false,
      );
    },
  );
});

test("localStorage 접근이 막혀도 예외 없이 지나간다", () => {
  globalThis.window = { location: { pathname: "/", search: "?utm_source=stage" } };
  Object.defineProperty(globalThis.window, "localStorage", {
    get() {
      throw new Error("storage blocked");
    },
  });
  globalThis.document = { referrer: "" };
  try {
    assert.doesNotThrow(() => captureSignupAttribution());
    assert.equal(getSignupAttribution(), null);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

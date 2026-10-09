import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import "./ts-module-loader.mjs";

const { buildTeamBeaconGuardScript } = await import("../src/lib/analytics/team-beacon-guard.ts");

function runGuard(search, stored = {}) {
  const store = { ...stored };
  const beacons = [];
  const fetched = [];
  const context = {
    location: { search },
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = value;
      },
      removeItem: (key) => {
        delete store[key];
      },
    },
    navigator: {
      sendBeacon: (url) => {
        beacons.push(url);
        return true;
      },
    },
    URLSearchParams,
    Promise,
    Response: class {
      constructor(body, init) {
        this.status = init.status;
      }
    },
    String,
  };
  context.window = {
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve("network");
    },
  };
  runInNewContext(buildTeamBeaconGuardScript(), context);
  return { context, store, beacons, fetched };
}

test("팀 표시가 없으면 Cloudflare 비컨을 그대로 보낸다", () => {
  const { context, beacons, store } = runGuard("");
  context.navigator.sendBeacon("https://acttub.com/cdn-cgi/rum", "x");
  assert.deepEqual(beacons, ["https://acttub.com/cdn-cgi/rum"]);
  assert.deepEqual(store, {});
});

test("?acttub_team=1 이면 표시를 남기고 비컨만 버린다", async () => {
  const { context, beacons, fetched, store } = runGuard("?acttub_team=1");
  assert.equal(context.navigator.sendBeacon("https://acttub.com/cdn-cgi/rum?x=1", "x"), true);
  context.navigator.sendBeacon("https://acttub.com/v2/other", "x");
  await context.window.fetch("https://acttub.com/cdn-cgi/rum");
  await context.window.fetch("/v2/me");
  assert.deepEqual(store, { acttub_team: "1" });
  assert.deepEqual(beacons, ["https://acttub.com/v2/other"]);
  assert.deepEqual(fetched, ["/v2/me"]);
});

test("?acttub_team=0 이면 표시를 지우고 비컨을 다시 보낸다", () => {
  const { context, beacons, store } = runGuard("?acttub_team=0", { acttub_team: "1" });
  context.navigator.sendBeacon("https://acttub.com/cdn-cgi/rum", "x");
  assert.deepEqual(store, {});
  assert.deepEqual(beacons, ["https://acttub.com/cdn-cgi/rum"]);
});

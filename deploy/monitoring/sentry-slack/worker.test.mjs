// 실행: node --test deploy/monitoring/sentry-slack/worker.test.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import worker, { toSlack } from "./worker.js";

const env = { RELAY_TOKEN: "secret", SENTRY_CLIENT_SECRET: "cs", SLACK_WEBHOOK_URL: "https://hooks.slack.test/x" };
const event = {
  project: 4511874784231424,
  level: "error",
  culprit: "com.acttub.Foo in bar",
  web_url: "https://acttub.sentry.io/issues/1/events/abc/",
  title: "ApiException: a<b",
  environment: "prod",
  user: { email: "x@y.z" },
};
const body = JSON.stringify({ action: "triggered", data: { event, triggered_rule: "r" } });
const sign = (b, secret = "cs") => createHmac("sha256", secret).update(b).digest("hex");
const post = (path, b, headers) => worker.fetch(new Request(`https://r.test/${path}`, { method: "POST", body: b, headers }), env);

let sent;
globalThis.fetch = async (url, init) => ((sent = { url, body: JSON.parse(init.body) }), new Response("ok"));

test("운영 이슈를 라벨·링크와 함께 바꾸고 이벤트 본문은 뺀다", () => {
  const { text } = toSlack(event);
  assert.match(text, /^\*\[운영\]\* acttub-api · error/);
  assert.match(text, /<https:\/\/acttub\.sentry\.io\/issues\/1\/events\/abc\/\|ApiException: a&lt;b>/);
  assert.doesNotMatch(text, /x@y\.z/);
});

test("environment가 태그에만 있어도 읽는다", () => {
  assert.match(toSlack({ title: "m", tags: [["environment", "dev"]] }).text, /^\*\[dev\]\*/);
});

test("토큰이 틀리면 404", async () => {
  assert.equal((await post("wrong", body, { "sentry-hook-signature": sign(body), "sentry-hook-resource": "event_alert" })).status, 404);
});

test("서명이 틀리거나 없으면 Slack을 부르지 않고 401", async () => {
  sent = undefined;
  assert.equal((await post("secret", body, { "sentry-hook-signature": sign(body, "other"), "sentry-hook-resource": "event_alert" })).status, 401);
  assert.equal((await post("secret", body, { "sentry-hook-resource": "event_alert" })).status, 401);
  assert.equal(sent, undefined);
});

test("event_alert가 아닌 리소스는 받기만 한다", async () => {
  sent = undefined;
  const b = JSON.stringify({ action: "created", data: {} });
  const res = await post("secret", b, { "sentry-hook-signature": sign(b), "sentry-hook-resource": "installation" });
  assert.equal(res.status, 200);
  assert.equal(sent, undefined);
});

test("event_alert는 Slack에 보내고 Slack 실패는 502", async () => {
  globalThis.fetch = async (url, init) => ((sent = { url, body: JSON.parse(init.body) }), new Response("", { status: 500 }));
  const res = await post("secret", body, { "sentry-hook-signature": sign(body), "sentry-hook-resource": "event_alert" });
  assert.equal(res.status, 502);
  assert.equal(sent.url, env.SLACK_WEBHOOK_URL);
  assert.match(sent.body.text, /\[운영\]/);
});

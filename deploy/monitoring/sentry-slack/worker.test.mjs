// 실행: node --test deploy/monitoring/sentry-slack/worker.test.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import worker, { alertRecord, toSlack } from "./worker.js";

const kv = new Map();
const ALERTS = {
  put: async (key, _value, { metadata }) => void kv.set(key, metadata),
  list: async () => ({ keys: [...kv].map(([name, metadata]) => ({ name, metadata })) }),
};
const env = { RELAY_TOKEN: "secret", SENTRY_CLIENT_SECRET: "cs", SLACK_BOT_TOKEN: "xoxb-t", SLACK_CHANNEL: "C1", ALERTS };
const event = {
  project: 4511874784231424,
  level: "error",
  culprit: "com.acttub.Foo in bar",
  web_url: "https://acttub.sentry.io/issues/1/events/abc/",
  issue_id: "7799006287",
  title: "ApiException: a<b",
  environment: "prod",
  user: { email: "x@y.z" },
};
const body = JSON.stringify({ action: "triggered", data: { event, triggered_rule: "운영 처음 남" } });
const sign = (b, secret = "cs") => createHmac("sha256", secret).update(b).digest("hex");
const post = (path, b, headers) => worker.fetch(new Request(`https://r.test/${path}`, { method: "POST", body: b, headers }), env);

let sent;
const slackOk = () => Response.json({ ok: true, channel: "C1", ts: "1.2" });
globalThis.fetch = async (url, init) => ((sent = { url, init, body: JSON.parse(init.body) }), slackOk());

test("운영 이슈를 라벨·링크와 함께 바꾸고 이벤트 본문은 뺀다", () => {
  const { text } = toSlack(event, "운영 계속 남");
  assert.match(text, /^\*\[운영 · 계속 남\]\* acttub-api · error/);
  assert.match(text, /<https:\/\/acttub\.sentry\.io\/issues\/1\/events\/abc\/\|ApiException: a&lt;b>/);
  assert.doesNotMatch(text, /x@y\.z/);
});

test("environment가 태그에만 있어도 읽는다", () => {
  assert.match(toSlack({ title: "m", tags: [["environment", "dev"]] }).text, /^\*\[dev\]\*/);
  assert.match(toSlack({ title: "m", environment: "dev" }, "dev 기본").text, /^\*\[dev · 기본\]\*/);
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

test("event_alert는 봇으로 채널에 보내고 Slack 실패(ok:false 포함)는 502", async () => {
  globalThis.fetch = async (url, init) => ((sent = { url, init, body: JSON.parse(init.body) }), Response.json({ ok: false, error: "not_in_channel" }));
  const res = await post("secret", body, { "sentry-hook-signature": sign(body), "sentry-hook-resource": "event_alert" });
  assert.equal(res.status, 502);
  assert.equal(sent.url, "https://slack.com/api/chat.postMessage");
  assert.equal(sent.init.headers.authorization, "Bearer xoxb-t");
  assert.equal(sent.body.channel, "C1");
  assert.match(sent.body.text, /\[운영 · 처음 남\]/);
  globalThis.fetch = async () => new Response("", { status: 500 });
  assert.equal((await post("secret", body, { "sentry-hook-signature": sign(body), "sentry-hook-resource": "event_alert" })).status, 502);
});

test("운영·dev 알림만 이슈 ID·환경·규칙·시각으로 남긴다", () => {
  const at = "2026-10-20T00:00:00.000Z";
  assert.deepEqual(alertRecord(JSON.parse(body), at), { issueId: "7799006287", env: "prod", rule: "운영 처음 남", at });
  assert.equal(alertRecord({ data: { event: { ...event, environment: "dev" }, triggered_rule: "dev 기본" } }, at).env, "dev");
  assert.equal(alertRecord({ data: { event: { ...event, environment: "local" } } }, at), null);
  // issue_id가 없으면 web_url에서 읽는다.
  assert.equal(alertRecord({ data: { event: { ...event, issue_id: undefined } } }, at).issueId, "1");
});

test("운영 알림은 Slack 메시지 위치와 함께 KV에 남고 GET /<토큰>/alerts로 읽힌다", async () => {
  kv.clear();
  globalThis.fetch = async () => slackOk();
  const res = await post("secret", body, { "sentry-hook-signature": sign(body), "sentry-hook-resource": "event_alert" });
  assert.equal(res.status, 200);
  const list = await (await worker.fetch(new Request("https://r.test/secret/alerts"), env)).json();
  assert.deepEqual(list.map((a) => [a.issueId, a.rule, a.channel, a.ts]), [["7799006287", "운영 처음 남", "C1", "1.2"]]);
  assert.equal((await worker.fetch(new Request("https://r.test/wrong/alerts"), env)).status, 404);
});

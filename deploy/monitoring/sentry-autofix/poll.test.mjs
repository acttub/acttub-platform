// 실행: node --test deploy/monitoring/sentry-autofix/poll.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { DAILY_RULE, merged, pick, summarize, verdictOf } from "./poll.mjs";

const alert = (issueId, at, rule = "운영 처음 남") => ({ issueId, at, rule });
const at = (iso) => ({ at: Date.parse(iso) });

test("처리한 적 없는 이슈의 알림은 먼저 온 것부터 모두 고른다", () => {
  const got = pick([alert("b", "2026-10-20T02:00:00.000Z"), alert("a", "2026-10-20T01:00:00.000Z")], { handled: {} });
  assert.deepEqual(got.map((a) => a.issueId), ["a", "b"]);
});

test("같은 이슈의 알림은 가장 늦은 것 하나만, 마지막 처리 뒤에 온 것만 고른다", () => {
  const state = { handled: { a: at("2026-10-20T05:00:00.000Z"), b: at("2026-10-20T05:00:00.000Z") } };
  const got = pick([
    alert("a", "2026-10-20T01:00:00.000Z"), // 처리 전 알림
    alert("b", "2026-10-20T01:00:00.000Z"),
    alert("b", "2026-10-20T06:00:00.000Z", "운영 급증"), // 처리 뒤 다시 온 알림
    alert("c", "2026-10-20T03:00:00.000Z"),
    alert("c", "2026-10-20T04:00:00.000Z"),
  ], state);
  assert.deepEqual(got.map((a) => [a.issueId, a.at]), [["c", "2026-10-20T04:00:00.000Z"], ["b", "2026-10-20T06:00:00.000Z"]]);
});

test("계속 남은 처음 보는 이슈와 지난번에 끝내지 못한 이슈만 고른다", () => {
  const before = "2026-10-20T05:00:00.000Z";
  const state = { handled: {
    pr: { ...at(before), verdict: "pr" },
    skip: { ...at(before), verdict: "skip" },
    fail: { ...at(before), verdict: "fail" },
    running: { ...at(before), verdict: "running" },
  } };
  const later = "2026-10-21T05:00:00.000Z";
  const got = pick(["new", "pr", "skip", "fail", "running"].map((id) => alert(id, later, DAILY_RULE)), state);
  assert.deepEqual(got.map((a) => a.issueId).sort(), ["fail", "new", "running"]);
});

test("계속 남은 머지한 PR이 운영에 나간 뒤에만 다시 고르고, 배포 전·닫힌 PR은 건너뛴다", () => {
  const before = { ...at("2026-10-20T05:00:00.000Z"), verdict: "pr" };
  const state = { handled: { shipped: { ...before, pr: "u/1" }, waiting: { ...before, pr: "u/2" }, closed: { ...before, pr: "u/3" } } };
  const deployed = (prev) => prev.pr === "u/1";
  const got = pick(["shipped", "waiting", "closed"].map((id) => alert(id, "2026-10-21T05:00:00.000Z", DAILY_RULE)), state, deployed);
  assert.deepEqual(got.map((a) => a.issueId), ["shipped"]);
});

test("건너뛴 계속 남이 앞서 온 다시 남을 가리지 않는다", () => {
  const state = { handled: { a: { ...at("2026-10-20T05:00:00.000Z"), verdict: "skip" } } };
  const got = pick([alert("a", "2026-10-20T06:00:00.000Z", "운영 다시 남"), alert("a", "2026-10-21T06:00:00.000Z", DAILY_RULE)], state);
  assert.deepEqual(got.map((a) => a.rule), ["운영 다시 남"]);
});

test("요약에는 우리 코드 프레임만 남기고 요청·사용자 정보는 뺀다", () => {
  const s = summarize(
    { shortId: "ACTTUB-API-1", title: "t", culprit: "c", permalink: "p", project: { slug: "acttub-api" }, substatus: "new", count: "1" },
    {
      entries: [
        { type: "exception", data: { values: [{ type: "E", value: "v", stacktrace: { frames: [
          { filename: "lib.java", function: "x", lineNo: 1, inApp: false },
          { filename: "Foo.java", function: "bar", lineNo: 7, inApp: true, context: [[6, "a"], [7, "boom()"]] },
        ] } }] } },
        { type: "request", data: { headers: [["cookie", "secret"]] } },
      ],
      tags: [{ key: "environment", value: "prod" }, { key: "user", value: "id:1" }],
      user: { email: "x@y.z" },
    },
  );
  assert.deepEqual(s.exceptions[0].frames, [{ file: "Foo.java", function: "bar", line: 7, code: "boom()" }]);
  assert.deepEqual(s.tags, { environment: "prod" });
  assert.doesNotMatch(JSON.stringify(s), /secret|x@y\.z|id:1/);
});

test("마지막 JSON 줄을 결과로 읽고, 없으면 fail", () => {
  assert.deepEqual(verdictOf('작업 끝\n{"verdict":"skip","reason":"외부 장애"}'), { verdict: "skip", reason: "외부 장애" });
  assert.equal(verdictOf("결과 없음").verdict, "fail");
});

test("main에 머지된 hotfix만 역병합 대상이고, 닫힌 hotfix는 다시 보지 않게 표시한다", () => {
  const handled = {
    merged: { verdict: "pr", hotfix: true, pr: "p1" },
    open: { verdict: "pr", hotfix: true, pr: "p2" },
    closed: { verdict: "pr", hotfix: true, pr: "p3" },
    done: { verdict: "pr", hotfix: true, pr: "p4", backmerge: "b" },
    devPr: { verdict: "pr", pr: "p5" }, // hotfix 전에 dev로 연 PR
    skip: { verdict: "skip", hotfix: true },
  };
  const states = { p1: "MERGED", p2: "OPEN", p3: "CLOSED", p4: "MERGED", p5: "MERGED" };
  const asked = [];
  const got = merged(handled, (pr) => (asked.push(pr), states[pr]));
  assert.deepEqual(got.map((h) => h.pr), ["p1"]);
  assert.deepEqual(asked, ["p1", "p2", "p3"]);
  assert.equal(handled.closed.backmerge, "닫힘");
  assert.equal(handled.open.backmerge, undefined);
});

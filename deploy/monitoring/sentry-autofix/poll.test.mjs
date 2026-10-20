// 실행: node --test deploy/monitoring/sentry-autofix/poll.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { pick, summarize, verdictOf } from "./poll.mjs";

const alert = (issueId, at, rule = "운영 기본") => ({ issueId, at, rule });
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

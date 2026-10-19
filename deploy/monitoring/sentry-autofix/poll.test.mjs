// 실행: node --test deploy/monitoring/sentry-autofix/poll.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { pick, summarize, verdictOf } from "./poll.mjs";

const DAY = 86_400_000;
const now = 100 * DAY;
const issue = (id, substatus, count) => ({ id, substatus, count: String(count) });

test("새 이슈는 한 번만, 이벤트 많은 순으로 고른다", () => {
  const state = { handled: { a: { at: now - DAY } }, runs: [] };
  const got = pick([issue("a", "new", 9), issue("b", "new", 1), issue("c", "new", 5), issue("d", "ongoing", 99)], state, now);
  assert.deepEqual(got.map((i) => i.id), ["c", "b"]);
});

test("재발은 7일이 지나야 다시 고른다", () => {
  const state = { handled: { a: { at: now - 2 * DAY }, b: { at: now - 8 * DAY } }, runs: [] };
  assert.deepEqual(pick([issue("a", "regressed", 1), issue("b", "regressed", 1)], state, now).map((i) => i.id), ["b"]);
});

test("24시간에 3번까지만 돈다", () => {
  const state = { handled: {}, runs: [now - 1000, now - 2000, now - 2 * DAY] };
  const got = pick([issue("a", "new", 3), issue("b", "new", 2), issue("c", "new", 1)], state, now);
  assert.deepEqual(got.map((i) => i.id), ["a"]);
  assert.equal(pick([issue("a", "new", 1)], { handled: {}, runs: [now, now, now] }, now).length, 0);
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

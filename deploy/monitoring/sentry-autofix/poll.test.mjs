// 실행: node --test deploy/monitoring/sentry-autofix/poll.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { pick, summarize, verdictOf } from "./poll.mjs";

const issue = (id, substatus, count, regressedAt) => ({ id, substatus, count: String(count), regressedAt });
const at = (iso) => ({ at: Date.parse(iso) });

test("새 이슈는 한 번만, 개수 제한 없이 이벤트 많은 순으로 고른다", () => {
  const state = { handled: { a: at("2026-10-19T00:00Z") } };
  const got = pick([issue("a", "new", 9), issue("b", "new", 1), issue("c", "new", 5), issue("d", "ongoing", 99), issue("e", "new", 3)], state);
  assert.deepEqual(got.map((i) => i.id), ["c", "e", "b"]);
});

test("재발은 마지막 재발 뒤에 처리한 적이 없을 때만 고른다", () => {
  const state = { handled: { a: at("2026-10-19T00:00Z"), b: at("2026-10-19T00:00Z") } };
  const got = pick([
    issue("a", "regressed", 1, "2026-10-19T03:00Z"), // 처리한 뒤 재발
    issue("b", "regressed", 1, "2026-10-18T00:00Z"), // 이번 재발은 이미 처리
    issue("c", "regressed", 1), // 처리한 적 없음
  ], state);
  assert.deepEqual(got.map((i) => i.id), ["a", "c"]);
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

import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { scrubUrl, scrubEvent, scrubBreadcrumb } = await import(
  "../src/lib/observability/sentry-shared"
);

// 방침 v3 7항이 "주소에 연습 세션 식별자 등이 포함되는 경우 제거한 뒤 전송한다"고
// 약속한다. 아래 테스트가 그 약속을 지킨다.

test("주소에서 쿼리를 통째로 버린다", () => {
  assert.equal(
    scrubUrl("https://acttub.com/practice/history?session=abc&next=/home"),
    "https://acttub.com/practice/history",
  );
});

test("경로에 박힌 UUID를 가린다", () => {
  assert.equal(
    scrubUrl("/v2/practice-sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
    "/v2/practice-sessions/<id>",
  );
});

test("대문자 UUID도 가린다", () => {
  assert.equal(
    scrubUrl("/v2/uploads/1B4E28BA-2FA1-11D2-883F-0016D3CCA427/complete"),
    "/v2/uploads/<id>/complete",
  );
});

test("해시도 뗀다", () => {
  assert.equal(scrubUrl("/terms#privacy"), "/terms");
});

test("캠페인 파라미터도 남기지 않는다 — GA와 달리 유입을 셀 이유가 없다", () => {
  assert.equal(scrubUrl("/home?utm_source=instagram"), "/home");
});

test("빈 문자열은 그대로 둔다", () => {
  assert.equal(scrubUrl(""), "");
});

test("이벤트의 요청 주소를 씻고 쿼리 문자열을 지운다", () => {
  const event = {
    request: {
      url: "https://acttub.com/practice?session=9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      query_string: "session=9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    },
  };

  scrubEvent(event);

  assert.equal(event.request.url, "https://acttub.com/practice");
  assert.equal("query_string" in event.request, false);
});

test("빵부스러기에 실린 주소도 씻는다", () => {
  const event = {
    breadcrumbs: [
      { data: { url: "/v2/practice-sessions/1b4e28ba-2fa1-11d2-883f-0016d3cca427" } },
      { data: { url: "/v2/profile?email=a@b.com" } },
      { data: {} },
      {},
    ],
  };

  scrubEvent(event);

  assert.equal(event.breadcrumbs[0].data.url, "/v2/practice-sessions/<id>");
  assert.equal(event.breadcrumbs[1].data.url, "/v2/profile");
});

test("주소가 없는 빵부스러기는 건드리지 않는다", () => {
  const crumb = { data: { status_code: 500 } };

  assert.deepEqual(scrubBreadcrumb(crumb), { data: { status_code: 500 } });
});

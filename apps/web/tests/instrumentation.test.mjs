// Sentry 진입점 둘(브라우저 instrumentation-client, Next 서버 instrumentation). DSN 이 있으면
// 주소를 씻는 공통 옵션으로 SDK 를 켜고, 서버는 Node 런타임에서만 켠다. 꺼진 경우는
// instrumentation-sentry-off.test.mjs 가 본다(DSN 은 모듈을 불러올 때 굳어 프로세스를 나눈다).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { sentryCalls } from "./fixtures/instrumentation-sentry.mjs";

process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@o1.ingest.sentry.io/1";
process.env.NEXT_PUBLIC_SENTRY_ENV = "dev";
process.env.NEXT_PUBLIC_APP_COMMIT = "abc1234";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return { url: new URL("./fixtures/instrumentation-sentry.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const originalRuntime = process.env.NEXT_RUNTIME;
afterEach(() => {
  sentryCalls.length = 0;
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

const UUID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

/** SDK 가 받은 옵션을 실제 이벤트에 써 본다. 함수는 따로 돌려 보고 나머지 값만 견준다. */
function describeInit(options) {
  const { beforeSend, beforeBreadcrumb, ...values } = options;
  return {
    values,
    event: beforeSend({
      request: { url: `https://acttub.com/practice/${UUID}?session=${UUID}#top`, query_string: `session=${UUID}` },
      breadcrumbs: [{ data: { url: `/v2/practices/${UUID}/feedback?x=1` } }],
    }),
    breadcrumb: beforeBreadcrumb({ category: "fetch", data: { url: `/v2/videos/${UUID}` } }),
  };
}

const expectedInit = {
  values: {
    dsn: "https://public@o1.ingest.sentry.io/1",
    environment: "dev",
    release: "abc1234",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  },
  event: {
    request: { url: "https://acttub.com/practice/<id>" },
    breadcrumbs: [{ data: { url: "/v2/practices/<id>/feedback" } }],
  },
  breadcrumb: { category: "fetch", data: { url: "/v2/videos/<id>" } },
};

test("브라우저 진입점은 DSN 이 있으면 주소를 씻는 옵션으로 Sentry 를 켜고 화면 전환을 넘긴다", async () => {
  const { onRouterTransitionStart } = await import("../src/instrumentation-client.ts");

  assert.deepEqual(
    sentryCalls.map(([name, options]) => [name, describeInit(options)]),
    [["init", expectedInit]],
  );

  onRouterTransitionStart("/practice", "push");
  assert.deepEqual(sentryCalls.at(-1), ["captureRouterTransitionStart", ["/practice", "push"]]);
});

test("서버 진입점은 Node 런타임에서만 같은 옵션으로 Sentry 를 켠다", async () => {
  const { register } = await import("../src/instrumentation.ts");

  process.env.NEXT_RUNTIME = "edge";
  await register();
  assert.deepEqual(sentryCalls, []);

  process.env.NEXT_RUNTIME = "nodejs";
  await register();
  assert.deepEqual(
    sentryCalls.map(([name, options]) => [name, describeInit(options)]),
    [["init", expectedInit]],
  );
});

test("서버 렌더 중 난 에러는 Sentry 의 요청 오류 수집으로 넘긴다", async () => {
  const { onRequestError } = await import("../src/instrumentation.ts");
  const error = new Error("렌더 실패");

  onRequestError(error, { path: "/home" }, { routePath: "/home" });

  assert.deepEqual(sentryCalls, [["captureRequestError", [error, { path: "/home" }, { routePath: "/home" }]]]);
});

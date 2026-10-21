// DSN 이 비어 있으면(로컬·테스트) Sentry 를 켜지 않는다. 그래도 Next 가 찾는 이름은 내보내야 한다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import "./ts-module-loader.mjs";
import { sentryCalls } from "./fixtures/instrumentation-sentry.mjs";

delete process.env.NEXT_PUBLIC_SENTRY_DSN;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return { url: new URL("./fixtures/instrumentation-sentry.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test("DSN 이 없으면 두 진입점 모두 Sentry 를 켜지 않고, 화면 전환 이름은 그대로 SDK 로 넘긴다", async () => {
  const { onRouterTransitionStart } = await import("../src/instrumentation-client.ts");
  const { register } = await import("../src/instrumentation.ts");

  process.env.NEXT_RUNTIME = "nodejs";
  await register();
  onRouterTransitionStart("/home", "replace");

  assert.deepEqual(sentryCalls, [["captureRouterTransitionStart", ["/home", "replace"]]]);
});

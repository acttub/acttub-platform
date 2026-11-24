// Next 서버에서 실제 Sentry SDK 가 응답마다 붙이는 close 리스너 수를 센다(SOMA-1109).
// Next 의 rewrites 프록시(/v2/*·/health)는 응답 하나에 close 리스너를 이미 9개 붙인다. Sentry 몫이 둘이면
// Node 기본 한도 10을 넘어 프록시 요청마다 MaxListenersExceededWarning 이 한 줄씩 찍힌다.
// SDK 를 진짜로 켜므로 대역을 쓰는 instrumentation.test.mjs 와 프로세스를 나눈다.
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";

import "./ts-module-loader.mjs";

// 이벤트를 받을 곳이 없는 주소다. 이 테스트는 아무것도 보내지 않는다.
process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@127.0.0.1:9/1";

const Sentry = await import("@sentry/nextjs");
const { register } = await import("../src/instrumentation.ts");

test("서버 Sentry 는 응답 하나에 close 리스너를 하나까지만 붙인다", async () => {
  process.env.NEXT_RUNTIME = "nodejs";
  await register();

  // Node 는 응답에 close 리스너를 스스로 붙이지 않는다. 처리기에 닿을 때 붙어 있는 것은 Sentry 몫이다.
  const server = http.createServer((_request, response) => {
    response.end(String(response.listenerCount("close")));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    const listeners = Number(await (await fetch(`http://127.0.0.1:${port}/v2/ping`)).text());
    assert.ok(listeners <= 1, `Sentry 가 응답에 close 리스너를 ${listeners}개 붙였다`);
  } finally {
    server.close();
    await Sentry.close(0);
  }
});

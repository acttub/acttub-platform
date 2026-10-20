// 상대역 목소리 모델 가중치 캐시. Cache Storage 와 네트워크를 이 파일 안의 대역으로 바꿔
// 캐시 적중·내려받기 진행률·캐시 저장 실패 때 돌려주는 바이트를 본다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

const { fetchModel, isCached } = await import("../src/lib/reading/audio/supertonic/cache.ts");

const URL_A = "https://cdn.example/a.onnx";
const URL_B = "https://cdn.example/b.onnx";

/** 이름별 Cache 하나를 흉내 낸다. put 에 넘어온 바이트를 그대로 들고 있다. */
function installCaches({ openFails = false, putFails = false } = {}) {
  const store = new Map();
  const opened = [];
  globalThis.caches = {
    async open(name) {
      opened.push(name);
      if (openFails) throw new Error("SecurityError");
      return {
        async match(url) {
          return store.has(url) ? new Response(store.get(url).slice()) : undefined;
        },
        async put(url, res) {
          if (putFails) throw new Error("QuotaExceededError");
          store.set(url, new Uint8Array(await res.arrayBuffer()));
        },
      };
    },
  };
  return { store, opened };
}

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
}

function serve(responder) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return responder(String(url));
  };
  return asked;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  delete globalThis.caches;
  globalThis.fetch = realFetch;
});

test("reading.supertonic-cache: 캐시에 없으면 받으면서 조각마다 진행률을 알리고, 받은 것을 캐시에 넣는다", async () => {
  const { store, opened } = installCaches();
  serve(() => new Response(streamOf([[1, 2], [3, 4, 5]]), { headers: { "content-length": "5" } }));
  const progress = [];

  const got = await fetchModel(URL_A, 999, (p) => progress.push(p));

  assert.deepEqual(Array.from(got), [1, 2, 3, 4, 5]);
  assert.deepEqual(progress, [
    { loaded: 2, total: 5, cached: false },
    { loaded: 5, total: 5, cached: false },
  ]);
  assert.deepEqual(opened, ["supertonic-3-int8-v1"]);
  assert.deepEqual(Array.from(store.get(URL_A)), [1, 2, 3, 4, 5]);

  got[0] = 99;
  assert.deepEqual(Array.from(store.get(URL_A)), [1, 2, 3, 4, 5], "캐시에는 복사본이 들어가 돌려준 버퍼를 바꿔도 그대로다");
});

test("reading.supertonic-cache: 서버가 길이를 알려주지 않으면 예상 용량을 전체로 보고 진행률을 낸다", async () => {
  installCaches();
  serve(() => new Response(streamOf([[7, 8, 9]])));
  const progress = [];

  await fetchModel(URL_A, 12, (p) => progress.push(p));

  assert.deepEqual(progress, [{ loaded: 3, total: 12, cached: false }]);
});

test("reading.supertonic-cache: 캐시에 있으면 네트워크를 타지 않고 캐시의 바이트를 돌려준다", async () => {
  const { store } = installCaches();
  store.set(URL_A, new Uint8Array([4, 2]));
  const asked = serve(() => new Response("안 불려야 한다"));
  const progress = [];

  const got = await fetchModel(URL_A, 999, (p) => progress.push(p));

  assert.deepEqual(Array.from(got), [4, 2]);
  assert.deepEqual(progress, [{ loaded: 2, total: 2, cached: true }]);
  assert.deepEqual(asked, []);
});

test("reading.supertonic-cache: 응답이 실패면 상태 코드와 주소를 담아 던진다", async () => {
  installCaches();
  serve(() => new Response("없음", { status: 404 }));

  await assert.rejects(fetchModel(URL_A, 1), { message: `모델을 받지 못했다 (404): ${URL_A}` });
});

test("reading.supertonic-cache: 스트림을 못 쓰는 응답은 통째로 받아 한 번에 진행률을 알리고 캐시에 넣는다", async () => {
  const { store } = installCaches();
  serve(() => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: null,
    arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer,
  }));
  const progress = [];

  const got = await fetchModel(URL_A, 100, (p) => progress.push(p));

  assert.deepEqual(Array.from(got), [5, 6, 7]);
  assert.deepEqual(progress, [{ loaded: 3, total: 3, cached: false }]);
  assert.deepEqual(Array.from(store.get(URL_A)), [5, 6, 7]);
});

test("reading.supertonic-cache: 캐시 저장이 실패해도 받은 바이트는 그대로 돌려준다", async () => {
  const { store } = installCaches({ putFails: true });
  serve(() => new Response(streamOf([[1, 1, 2]])));

  const got = await fetchModel(URL_A, 3);

  assert.deepEqual(Array.from(got), [1, 1, 2]);
  assert.equal(store.size, 0);
});

test("reading.supertonic-cache: Cache API 가 없거나 열리지 않아도 네트워크로 받는다", async () => {
  serve(() => new Response(streamOf([[3]])));
  assert.deepEqual(Array.from(await fetchModel(URL_A, 1)), [3]);

  installCaches({ openFails: true });
  serve(() => new Response(streamOf([[4]])));
  assert.deepEqual(Array.from(await fetchModel(URL_A, 1)), [4]);
});

test("reading.supertonic-cache: 모든 주소가 캐시에 있을 때만 받아 둔 것으로 본다", async () => {
  assert.equal(await isCached([URL_A]), false, "Cache API 가 없으면 받아 두지 않은 것");

  const { store } = installCaches();
  store.set(URL_A, new Uint8Array([1]));
  assert.equal(await isCached([URL_A, URL_B]), false);

  store.set(URL_B, new Uint8Array([2]));
  assert.equal(await isCached([URL_A, URL_B]), true);
});

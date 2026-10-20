// /v2/pg-review/* 의 대역. 화면이 보낸 요청을 "GET /config" 모양으로 모으고, 경로마다 준 응답을 차례로 돌려준다.
// 진짜 fetch 처럼 signal 이 끊기면 AbortError 로 거절한다.

export const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * @param routes `{ "GET /config": 응답 | 응답[] }`. 응답은 Response, Response 를 돌려주거나 던지는 함수,
 *   또는 deferred() 의 promise 다. 배열이면 부를 때마다 다음 것을 쓰고 마지막 것을 되풀이한다.
 */
export function serveBackend(routes) {
  const calls = [];
  const used = new Map();
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(String(input), "http://localhost:3000");
    const key = `${init.method ?? "GET"} ${url.pathname.replace("/v2/pg-review", "")}`;
    calls.push(init.body === undefined ? key : `${key} ${init.body}`);
    const route = routes[key];
    if (route === undefined) throw new Error(`대역에 없는 요청: ${key}`);
    const list = Array.isArray(route) ? route : [route];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const answer = list[Math.min(index, list.length - 1)];
    const pending = Promise.resolve().then(() =>
      typeof answer === "function" ? answer() : answer instanceof Response ? answer.clone() : answer,
    );
    const signal = init.signal;
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, reject);
    });
  };
  return calls;
}

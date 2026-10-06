// reading.script — 대본 넣기 화면 상태(useScriptImport). 나누는 중에 화면을 떠나면 폴링을 멈추고, 끝나도 다른 화면에서
// 대본을 들거나 배역 정하기로 옮기지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe, react } from "./mount-probe.mjs";

const { scriptImportProbe } = await import("./fixtures/script-import-probe.tsx");

const memory = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const running = { id: "import-1", status: "running", progress: { done_lines: 3, total_lines: 9 }, script_id: null, failure: null };
const done = { ...running, status: "succeeded", progress: { done_lines: 9, total_lines: 9 }, script_id: "script-9" };
const detail = { id: "script-9", title: "옥상, 밤", characters: [], lines: [], last_session: null };

/** 폴링 사이의 기다림을 테스트가 풀어 준다. 신호가 끊기면 기다림도 끊긴다. */
function fakeDeps() {
  const log = { polls: 0, scripts: 0, waits: [] };
  const deps = {
    startImport: async () => ({ import_id: "import-1", duplicate_script_id: null }),
    getImport: async () => {
      log.polls += 1;
      return log.polls === 1 ? running : done;
    },
    wait: (_ms, signal) =>
      new Promise((resolve, reject) => {
        log.waits.push(resolve);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    now: () => 0,
    getScript: async () => {
      log.scripts += 1;
      return detail;
    },
  };
  return { deps, log };
}

const flush = () => react.act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("reading.script: 나누는 중에 화면을 떠나면 폴링이 멈추고, 그 뒤 기다림이 풀려도 대본을 들거나 배역 정하기로 가지 않는다", async () => {
  memory.clear();
  const { deps, log } = fakeDeps();
  let saved = 0;
  const probe = mountProbe(scriptImportProbe(deps, () => (saved += 1)));

  probe.act((importer) => importer.start({ kind: "text", text: "윤서: 안녕.", source: "paste" }));
  await flush();
  assert.equal(log.polls, 1);
  assert.equal(probe.latest.view.kind, "splitting");

  probe.unmount();
  for (const resolve of log.waits) resolve();
  await flush();

  assert.equal(log.polls, 1);
  assert.equal(log.scripts, 0);
  assert.equal(saved, 0);
  assert.equal(sessionStorage.getItem("reading.script"), null);
});

test("reading.script: 화면에 머물면 같은 흐름이 끝까지 가 대본을 들고 배역 정하기로 간다", async () => {
  memory.clear();
  const { deps, log } = fakeDeps();
  let saved = 0;
  const probe = mountProbe(scriptImportProbe(deps, () => (saved += 1)));

  probe.act((importer) => importer.start({ kind: "text", text: "윤서: 안녕.", source: "paste" }));
  await flush();
  for (const resolve of log.waits) resolve();
  await flush();

  assert.equal(log.polls, 2);
  assert.equal(log.scripts, 1);
  assert.equal(saved, 1);
  assert.equal(JSON.parse(sessionStorage.getItem("reading.script")).id, "script-9");
  probe.unmount();
});

import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { guardUnfinishedUpload } = await import(
  "../src/features/workspace/upload-exit-guard.ts"
);

/** 등록·해제를 받아 적는 가짜 창 */
function fakeWindow() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    removeEventListener: (type, listener) => {
      const at = listeners.findIndex((l) => l.type === type && l.listener === listener);
      if (at !== -1) listeners.splice(at, 1);
    },
  };
}

function fireBeforeUnload(win) {
  let prevented = false;
  const event = {
    returnValue: undefined,
    preventDefault: () => {
      prevented = true;
    },
  };
  for (const { listener } of win.listeners) listener(event);
  return { prevented, returnValue: event.returnValue };
}

// practice.record: "웹에서 마무리 전 탭 닫기: 경고가 뜬다"
test("practice.record 마무리 전 영상이 있으면 탭을 닫을 때 경고가 뜬다", () => {
  const win = fakeWindow();
  guardUnfinishedUpload(win, true);

  assert.equal(win.listeners.length, 1);
  const fired = fireBeforeUnload(win);
  assert.equal(fired.prevented, true);
  // 값이 비어 있으면 옛 브라우저가 묻지 않고 닫는다.
  assert.equal(fired.returnValue, "");
});

test("practice.record 올릴 것이 없으면 경고를 걸지 않는다", () => {
  const win = fakeWindow();
  const release = guardUnfinishedUpload(win, false);

  assert.equal(win.listeners.length, 0);
  // 걷는 함수는 언제 불러도 안전하다.
  release();
  assert.equal(win.listeners.length, 0);
});

test("practice.record 마무리가 끝나면 경고를 걷는다", () => {
  const win = fakeWindow();
  const release = guardUnfinishedUpload(win, true);
  release();

  assert.equal(win.listeners.length, 0);
  assert.equal(fireBeforeUnload(win).prevented, false);
});

test("practice.record 창이 없는 자리(서버 렌더)에서도 터지지 않는다", () => {
  assert.doesNotThrow(() => guardUnfinishedUpload(null, true)());
  assert.doesNotThrow(() => guardUnfinishedUpload(undefined, true)());
});

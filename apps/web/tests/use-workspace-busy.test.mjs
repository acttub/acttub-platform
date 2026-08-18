// 화면 뒤에서 도는 일 셋. 이 훅이 있는 이유는 "누가 켰는지" 를 아는 것이라, 켜고 끄는
// 순서를 실제로 흘려 넣어 본다 — 순수 함수로는 "그 사이 다른 연습이 끼어들었다" 라는
// 순서 자체가 없다.
import assert from "node:assert/strict";
import { before, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount } from "./mount-probe.mjs";

let Probe;

before(async () => {
  ({ WorkspaceBusyProbe: Probe } = await import(
    "./fixtures/workspace-busy-probe.tsx"
  ));
});

const mountProbe = () => mount(Probe);

/** 일을 시작하고, 그 일의 끝맺음을 돌려받는다 — 부르는 자리가 하는 그대로다. */
const start = (probe, work, sessionId) =>
  probe.act((busy) => busy.start(work, sessionId));
const finish = (probe, done) => probe.act(() => done());
const clear = (probe) => probe.act((busy) => busy.clear());

test("아무 일도 안 돌면 아무것도 잠기지 않는다", () => {
  const probe = mountProbe();
  try {
    assert.deepEqual(probe.latest.disabled, {
      remove: false,
      backToChat: false,
      blockageSubmit: false,
    });
    assert.equal(probe.text(), "none");
  } finally {
    probe.unmount();
  }
});

test("지난 연습을 여는 중에는 지우기와 대화 되돌리기가 잠긴다", () => {
  const probe = mountProbe();
  try {
    start(probe, "sessionLoading", "s-1");
    assert.deepEqual(probe.latest.disabled, {
      remove: true,
      backToChat: true,
      // 여는 중에는 막힘을 고르는 화면이 아니다 — 그 전이가 준비 화면으로 되돌렸다.
      blockageSubmit: false,
    });
    assert.equal(probe.text(), "remove,backToChat");
  } finally {
    probe.unmount();
  }
});

test("지우는 중에는 셋 다 잠긴다", () => {
  const probe = mountProbe();
  try {
    start(probe, "deleting", "s-1");
    assert.deepEqual(probe.latest.disabled, {
      remove: true,
      backToChat: true,
      blockageSubmit: true,
    });
  } finally {
    probe.unmount();
  }
});

test("대화를 다시 여는 중에는 지우기만 잠긴다", () => {
  const probe = mountProbe();
  try {
    start(probe, "restartingChat", "s-1");
    assert.deepEqual(probe.latest.disabled, {
      remove: true,
      // 이 길은 시작하는 순간 노트 화면을 떠나 그 버튼 자체가 사라진다.
      backToChat: false,
      blockageSubmit: false,
    });
  } finally {
    probe.unmount();
  }
});

test("끝맺음은 자기가 켠 것만 끈다 — 그 사이 다른 연습이 이어받았으면 손대지 않는다", () => {
  const probe = mountProbe();
  try {
    // 목록에서 하나를 열고, 답이 오기 전에 다른 하나를 연다.
    const doneFirst = start(probe, "sessionLoading", "s-1");
    const doneSecond = start(probe, "sessionLoading", "s-2");
    // 늦게 도착한 첫 조회가 끝난다. 지금 도는 것은 두 번째 연습의 조회다.
    finish(probe, doneFirst);
    assert.equal(probe.latest.disabled.remove, true, "뒤엣것이 아직 돌고 있다");

    finish(probe, doneSecond);
    assert.equal(probe.latest.disabled.remove, false);
  } finally {
    probe.unmount();
  }
});

test("한 일의 끝맺음이 다른 일의 표시를 끄지 않는다", () => {
  const probe = mountProbe();
  try {
    // 막힌 대화를 다시 여는 중에 목록에서 다른 연습을 누른 길이다. 불린 하나를 셋이
    // 나눠 쓰던 옛 코드에서는 이 조회의 끝이 아직 도는 재시작의 표시까지 껐다.
    start(probe, "restartingChat", "s-1");
    const doneLoading = start(probe, "sessionLoading", "s-2");
    finish(probe, doneLoading);

    assert.equal(probe.latest.disabled.remove, true, "재시작이 아직 돌고 있다");
    assert.equal(probe.latest.disabled.backToChat, false, "조회는 끝났다");
  } finally {
    probe.unmount();
  }
});

test("새 연습으로 되돌아가면 도는 일이 한 번에 놓인다", () => {
  const probe = mountProbe();
  try {
    const doneLoading = start(probe, "sessionLoading", "s-1");
    start(probe, "restartingChat", "s-1");
    clear(probe);
    assert.equal(probe.text(), "none");

    // 되돌아간 뒤에 늦게 도착한 조회는 아무것도 되살리지 못한다.
    finish(probe, doneLoading);
    assert.equal(probe.text(), "none");
  } finally {
    probe.unmount();
  }
});

test("도는 일이 그대로면 손잡이도 잠금도 같은 것이다", () => {
  const probe = mountProbe();
  try {
    const first = probe.latest;
    start(probe, "deleting", "s-1");
    const second = probe.latest;
    // 실제로 다시 그려졌는지부터 — 같은 객체를 두 번 본 것이면 아무것도 안 잰 것이다.
    assert.ok(probe.everyRender.length > 1);
    assert.notEqual(first, second);

    // 부르는 쪽이 이 둘을 useCallback 의존성에 싣고, 그 끝에 이펙트가 있다.
    assert.equal(first.start, second.start);
    assert.equal(first.clear, second.clear);
    // 잠금은 바뀌었으니 새 객체여야 하고,
    assert.notEqual(first.disabled, second.disabled);

    // 아무것도 안 바뀌는 조작 뒤에는 그대로여야 한다 — 이미 그 연습이 주인이다.
    start(probe, "deleting", "s-1");
    assert.equal(probe.latest.disabled, second.disabled);
  } finally {
    probe.unmount();
  }
});

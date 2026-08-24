// 서버에서 하나를 읽는 일을 이 훅이 혼자 맡는다. 화면 아홉에서 걷어 온 것이라, 걷힌
// 아홉이 저마다 판정했던 것을 여기 한 곳에서 잰다 — 특히 그중 둘이 조용히 틀렸던 것
// (취소된 조회가 오류를 그린다)과, 이 훅이 **새로 여는** 위험(매 렌더 새로 서는 load).
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe, react } from "./mount-probe.mjs";

let Probe;
let Eager;
let pendingLoads;
let resetLoads;

before(async () => {
  ({
    ResourceProbe: Probe,
    EagerResourceProbe: Eager,
    pendingLoads,
    resetLoads,
  } = await import("./fixtures/resource-probe.tsx"));
});

beforeEach(() => {
  resetLoads();
});

/** 답을 흘려 넣는다. act 가 마이크로태스크까지 비운 뒤에 돌아온다. */
const settle = (hand) => react.act(async () => hand());

const only = () => {
  const loads = pendingLoads();
  assert.equal(loads.length, 1, `조회가 ${loads.length}건이다`);
  return loads[0];
};

test("아직 묻지 않는 자리는 idle 이고 조회를 띄우지 않는다", () => {
  const probe = mountProbe(Probe);
  try {
    assert.equal(probe.latest.resource.state, "idle");
    assert.equal(pendingLoads().length, 0);
    assert.equal(probe.text(), "idle");
  } finally {
    probe.unmount();
  }
});

test("첫 렌더부터 묻는 자리는 loading 으로 서고 그 키로 조회한다", () => {
  const probe = mountProbe(Eager);
  try {
    assert.equal(probe.latest.resource.state, "loading");
    assert.equal(only().key, "a");
  } finally {
    probe.unmount();
  }
});

test("게이트가 열리는 순간에 묻는다", () => {
  const probe = mountProbe(Probe);
  try {
    probe.act((value) => value.setKey("a"));
    assert.equal(probe.latest.resource.state, "loading");
    assert.equal(only().key, "a");
  } finally {
    probe.unmount();
  }
});

test("답이 오면 ready 가 되고 받은 시각을 함께 든다", async () => {
  const probe = mountProbe(Eager);
  try {
    await settle(() => only().resolve("입시 정보"));
    const { resource } = probe.latest;
    assert.equal(resource.state, "ready");
    assert.equal(resource.data, "입시 정보");
    // 프리렌더에는 서버 시각이 없다. 화면이 "마감 D-2" 를 재려면 답이 온 시각이 필요하다.
    assert.equal(typeof resource.receivedAt, "number");
  } finally {
    probe.unmount();
  }
});

test("실패하면 오류가 들고 온 말을 그대로 든다", async () => {
  const probe = mountProbe(Eager);
  try {
    await settle(() => only().reject(new Error("입시 정보가 아직 없어요.")));
    assert.deepEqual(probe.latest.resource, {
      state: "failed",
      message: "입시 정보가 아직 없어요.",
    });
  } finally {
    probe.unmount();
  }
});

test("읽을 말이 없는 실패는 부르는 자리가 준 문구로 돌아간다", async () => {
  const probe = mountProbe(Eager);
  try {
    // 빈 message 를 그대로 그리면 화면에 아무 말도 뜨지 않는다. 인라인으로 적힌 넷이
    // 그랬다.
    await settle(() => only().reject(new Error("")));
    assert.equal(probe.latest.resource.message, "불러오지 못했어요.");
  } finally {
    probe.unmount();
  }
});

test("키가 바뀌면 옛 답을 버리고 그 자리에서 다시 묻는다", async () => {
  const probe = mountProbe(Eager);
  try {
    await settle(() => only().resolve("가"));
    assert.equal(probe.latest.resource.state, "ready");

    resetLoads();
    probe.act((value) => value.setKey("b"));

    // 옛 답이 한 프레임도 남지 않는다 — 그것이 "남의 것을 든 화면" 이다.
    assert.equal(probe.latest.resource.state, "loading");
    assert.equal(only().key, "b");
  } finally {
    probe.unmount();
  }
});

test("키가 바뀌면 앞의 조회를 취소한다", () => {
  const probe = mountProbe(Eager);
  try {
    const first = only();
    probe.act((value) => value.setKey("b"));
    assert.equal(first.signal.aborted, true);
  } finally {
    probe.unmount();
  }
});

test("취소된 조회의 답은 화면을 바꾸지 않는다", async () => {
  const probe = mountProbe(Eager);
  try {
    const first = only();
    probe.act((value) => value.setKey("b"));

    await settle(() => first.resolve("남의 것"));

    // 새 키의 답을 기다리는 중이어야 한다. 옛 답이 통과하면 "b" 를 물어 놓고 "a" 의
    // 내용을 그린다.
    assert.equal(probe.latest.resource.state, "loading");
  } finally {
    probe.unmount();
  }
});

test("취소된 조회의 실패는 오류를 그리지 않는다", async () => {
  const probe = mountProbe(Eager);
  try {
    const first = only();
    probe.act((value) => value.setKey("b"));

    // memory-panel 이 이것을 걸러내지 않아, 화면을 떠나며 취소된 조회가 "지금은 불러오지
    // 못했어요" 를 그렸다.
    await settle(() => first.reject(new Error("취소되었습니다.")));

    assert.equal(probe.latest.resource.state, "loading");
  } finally {
    probe.unmount();
  }
});

test("게이트가 닫히면 idle 로 돌아가고 조회를 취소한다", () => {
  const probe = mountProbe(Eager);
  try {
    const first = only();
    probe.act((value) => value.setKey(null));

    assert.equal(probe.latest.resource.state, "idle");
    assert.equal(first.signal.aborted, true);
  } finally {
    probe.unmount();
  }
});

test("언마운트가 진행 중인 조회를 취소한다", () => {
  const probe = mountProbe(Eager);
  const first = only();
  probe.unmount();
  assert.equal(first.signal.aborted, true);
});

test("언마운트 뒤에 온 답은 렌더를 일으키지 않는다", async () => {
  const probe = mountProbe(Eager);
  const first = only();
  probe.unmount();

  const rendered = probe.everyRender.length;
  await settle(() => first.resolve("늦게 온 답"));

  assert.equal(probe.everyRender.length, rendered);
});

test("load 가 매 렌더 새 함수여도 다시 묻지 않는다", () => {
  // 이 훅이 **새로 여는** 위험이다. 옛 코드는 의존성을 손으로 적었으므로 이런 자리가
  // 없었다. load 를 의존성에 실으면 렌더마다 조회를 다시 띄우고 자기 앞의 것을 취소한다.
  const probe = mountProbe(Eager);
  try {
    const first = only();
    probe.act((value) => value.rerender());
    probe.act((value) => value.rerender());
    probe.act((value) => value.rerender());

    assert.equal(pendingLoads().length, 1);
    assert.equal(first.signal.aborted, false);
  } finally {
    probe.unmount();
  }
});

test("같은 키로 다시 렌더해도 답이 그대로 남는다", async () => {
  const probe = mountProbe(Eager);
  try {
    await settle(() => only().resolve("가"));
    probe.act((value) => value.rerender());

    assert.equal(probe.latest.resource.state, "ready");
    assert.equal(probe.latest.resource.data, "가");
    assert.equal(pendingLoads().length, 1);
  } finally {
    probe.unmount();
  }
});

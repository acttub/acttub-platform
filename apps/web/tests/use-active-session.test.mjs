// 지금 화면인 연습이 무엇인가를 들고 있는 훅. 화면이 그리는 값과 기다림 뒤에 묻는 값이
// 서로 다른 시점에 답한다는 것이 이 훅의 존재 이유라, 그 어긋남을 실제로 렌더해서 본다 —
// 순수 함수로는 "아직 다시 그려지기 전" 이라는 시점 자체가 없다.
import assert from "node:assert/strict";
import { before, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

let react;
let createRoot;
let Probe;

before(async () => {
  react = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  ({ ActiveSessionProbe: Probe } = await import(
    "./fixtures/active-session-probe.tsx"
  ));
});

// 훅을 붙인 컴포넌트를 띄우고, 마지막 렌더에서 본 값과 조작 손잡이를 돌려준다.
function mountProbe() {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const seen = [];
  react.act(() => {
    root.render(
      react.createElement(Probe, { onRender: (value) => seen.push(value) }),
    );
  });
  return {
    get latest() {
      return seen.at(-1);
    },
    /** 렌더마다 훅이 돌려준 것. 동일성은 두 렌더의 것을 견줘야 잴 수 있다. */
    get everyRender() {
      return seen;
    },
    text: () => container.textContent,
    /**
     * 자리를 세우면서, 아직 다시 그려지기 전인 그 자리에서 무엇이 보이는지도 함께 본다.
     * act 는 콜백이 끝난 뒤에 렌더를 흘리므로 콜백 안이 곧 "기다림 뒤에 돌아온 코드" 다.
     */
    setCurrent: (sessionId, peek = () => undefined) => {
      let peeked;
      react.act(() => {
        seen.at(-1).setCurrent(sessionId);
        peeked = peek(seen.at(-1));
      });
      return peeked;
    },
    unmount: () => {
      react.act(() => root.unmount());
      container.remove();
    },
  };
}

test("아무도 없는 자리는 어느 연습이든 가질 수 있고, 아직 누구의 것도 아니다", () => {
  const probe = mountProbe();
  try {
    assert.equal(probe.latest.id, null);
    assert.equal(probe.latest.current(), null);
    assert.equal(probe.latest.isCurrent("s-1"), false);
    assert.equal(probe.latest.isCurrentOrFree("s-1"), true);
    assert.equal(probe.latest.isCurrentOrFree("s-2"), true);
  } finally {
    probe.unmount();
  }
});

test("자리를 세우면 그 자리에서 곧바로 가드가 답한다 — 화면은 아직 다시 그려지기 전이다", () => {
  const probe = mountProbe();
  try {
    // 이 훅이 두 벌을 드는 유일한 이유다. 취소 가드는 답이 돌아온 그 자리에서 물어야
    // 하는데, 그리는 값만 있으면 다음 렌더까지 옛 연습이 아직 자리에 있다고 답한다.
    const peeked = probe.setCurrent("s-1", (active) => ({
      guard: active.isCurrent("s-1"),
      seat: active.current(),
      drawn: active.id,
    }));
    assert.equal(peeked.guard, true);
    // 자리를 묻는 것도 같은 자리에서 답한다 — 그리는 값을 돌려주면 기다림 뒤에
    // 자기가 만든 연습을 못 알아본다.
    assert.equal(peeked.seat, "s-1");
    assert.equal(peeked.drawn, null);

    // 그리고 렌더가 흐른 뒤에는 화면도 따라온다.
    assert.equal(probe.latest.id, "s-1");
    assert.equal(probe.text(), "s-1");
  } finally {
    probe.unmount();
  }
});

test("자리를 세우면 남은 그 자리를 가질 수 없다", () => {
  const probe = mountProbe();
  try {
    probe.setCurrent("s-1");
    assert.equal(probe.latest.current(), "s-1");
    assert.equal(probe.latest.isCurrent("s-1"), true);
    assert.equal(probe.latest.isCurrent("s-2"), false);
    // 자리가 찬 뒤에는 남을 걸러낸다. 앞 케이스에서 통과시킨 것과 같은 물음이다.
    assert.equal(probe.latest.isCurrentOrFree("s-2"), false);
    // 이미 자기 것인 자리는 계속 자기 것이다 — 주소로 들어온 길이 조회를 마치고
    // 돌아왔을 때 자기 자신에게 걸리면 안 된다.
    assert.equal(probe.latest.isCurrentOrFree("s-1"), true);
  } finally {
    probe.unmount();
  }
});

test("다른 연습이 자리를 가져가면 앞엣것은 그 자리를 잃는다", () => {
  const probe = mountProbe();
  try {
    probe.setCurrent("s-1");
    probe.setCurrent("s-2");
    assert.equal(probe.latest.isCurrent("s-1"), false);
    assert.equal(probe.latest.isCurrentOrFree("s-1"), false);
    assert.equal(probe.latest.isCurrent("s-2"), true);
    assert.equal(probe.text(), "s-2");
  } finally {
    probe.unmount();
  }
});

test("자리를 비우면 다시 아무나 가질 수 있다", () => {
  const probe = mountProbe();
  try {
    probe.setCurrent("s-1");
    // 새 연습 준비 화면으로 되돌아가는 길이다.
    probe.setCurrent(null);
    assert.equal(probe.latest.id, null);
    assert.equal(probe.latest.current(), null);
    assert.equal(probe.latest.isCurrent("s-1"), false);
    assert.equal(probe.latest.isCurrentOrFree("s-1"), true);
    assert.equal(probe.latest.isCurrentOrFree("s-2"), true);
    assert.equal(probe.text(), "none");
  } finally {
    probe.unmount();
  }
});

test("자리가 바뀌어도 손잡이 넷은 같은 함수다", () => {
  const probe = mountProbe();
  try {
    const first = probe.latest;
    probe.setCurrent("s-1");
    const second = probe.latest;
    // 실제로 다시 그려졌는지부터 — 같은 객체를 두 번 본 것이면 아무것도 안 잰 것이다.
    assert.ok(probe.everyRender.length > 1);
    assert.notEqual(first, second);

    // 부르는 쪽이 이 넷을 이펙트 의존성에 싣는다. 하나라도 매 렌더 새로 서면 주소로
    // 연 연습의 조회가 자기 정리에 취소당해 화면이 조용히 안 열린다.
    assert.equal(first.current, second.current);
    assert.equal(first.isCurrent, second.isCurrent);
    assert.equal(first.isCurrentOrFree, second.isCurrentOrFree);
    assert.equal(first.setCurrent, second.setCurrent);
  } finally {
    probe.unmount();
  }
});

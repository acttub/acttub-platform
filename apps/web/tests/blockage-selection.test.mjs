// practice.start: 준비 화면에서 이번 연습에 받을 도움(큰 갈래)과 상세 서술을 고르는 칸.
// 고른 값은 부모가 든 상태로 돌아가고, 시작 버튼이 그 상태로 요청을 만든다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { BlockageFields } = await import("../src/features/practice/blockage-selection.tsx");

afterEach(cleanup);

/** 준비 화면처럼 상태를 들고, 칸이 돌려준 상태를 차례로 적어 둔다. */
function mount(initial = { kind: null, detail: "" }) {
  const changes = [];
  function Harness() {
    const [state, setState] = react.useState(initial);
    return react.createElement(BlockageFields, {
      state,
      onChange: (next) => { changes.push(next); setState(next); },
    });
  }
  render(react.createElement(Harness));
  return changes;
}

const pressed = () =>
  screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent);

test("아무것도 고르지 않은 채로 시작할 수 있고, 세 가지 도움을 보인다", () => {
  mount();

  assert.deepEqual(screen.getAllByRole("button").map((button) => button.textContent), ["대사 분석", "연기 표현", "잘 모르겠어요"]);
  assert.deepEqual(pressed(), []);
  assert.equal(screen.getByText(/고르지 않아도/).textContent, "고르지 않아도 영상에서 보이는 것부터 같이 찾아요.");
});

test("도움을 고르면 저장값으로 상태가 바뀌고 고른 것의 설명이 보인다", () => {
  const changes = mount();

  fireEvent.click(screen.getByRole("button", { name: "대사 분석" }));
  assert.deepEqual(changes.at(-1), { kind: "분석", detail: "" });
  assert.deepEqual(pressed(), ["대사 분석"]);
  assert.equal(screen.getByText(/같이 봐요/).textContent, "이 말이 왜 지금 나오는지부터 같이 봐요");

  fireEvent.click(screen.getByRole("button", { name: "잘 모르겠어요" }));
  assert.deepEqual(changes.at(-1), { kind: "그 외", detail: "" });
  assert.deepEqual(pressed(), ["잘 모르겠어요"]);
  assert.equal(screen.queryByText(/같이 봐요/), null);
  assert.equal(screen.getByText(/꺼내 드려요/).textContent, "영상에서 보이는 것부터 꺼내 드려요");
});

test("고른 도움을 다시 눌러도 풀리지 않는다", () => {
  const changes = mount({ kind: "표현", detail: "" });

  fireEvent.click(screen.getByRole("button", { name: "연기 표현" }));
  assert.deepEqual(changes.at(-1), { kind: "표현", detail: "" });
  assert.deepEqual(pressed(), ["연기 표현"]);
});

test("상세 서술은 고른 도움을 지우지 않고 상태에 담기며 500자까지 받는다", () => {
  const changes = mount({ kind: "표현", detail: "" });
  const detail = screen.getByPlaceholderText("편하게 적어 주세요");

  fireEvent.change(detail, { target: { value: "마지막 대사에서 목소리가 작아져요" } });
  assert.deepEqual(changes.at(-1), { kind: "표현", detail: "마지막 대사에서 목소리가 작아져요" });
  assert.equal(detail.value, "마지막 대사에서 목소리가 작아져요");
  assert.deepEqual(pressed(), ["연기 표현"]);
  // practice.start: 막힘 서술은 500자까지(501자는 서버가 422).
  assert.equal(detail.maxLength, 500);
});

import assert from "node:assert/strict";
import test from "node:test";
import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

const { createRoot } = await import("react-dom/client");
const { CoachComposer } = await import("../src/features/workspace/coach-composer.tsx");

function mount({ initial = "", sending = false, inputEnabled = true } = {}) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const sent = [];
  function Harness() {
    const [answer, setAnswer] = react.useState(initial);
    return react.createElement(CoachComposer, {
      answer, setAnswer, sending, inputEnabled, onSend: () => sent.push(answer),
    });
  }
  react.act(() => root.render(react.createElement(Harness)));
  return {
    sent,
    text: () => container.textContent,
    input: container.querySelector("textarea"),
    click(label) {
      const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
      assert.ok(button, label);
      react.act(() => button.click());
    },
    unmount() { react.act(() => root.unmount()); container.remove(); },
  };
}

test("asking the coach focuses the draft without spending a turn or replacing text", () => {
  const view = mount({ initial: "마지막 단어가 너무 긴가요?" });
  try {
    view.click("코치에게 질문");
    assert.deepEqual(view.sent, []);
    assert.equal(view.input.value, "마지막 단어가 너무 긴가요?");
    assert.equal(window.document.activeElement, view.input);
    assert.equal(view.input.placeholder, "코치에게 궁금한 점을 적어 주세요");
    view.click("보내기 →");
    assert.deepEqual(view.sent, ["마지막 단어가 너무 긴가요?"]);
  } finally { view.unmount(); }
});

test("help and practice-later shortcuts prepare explicit requests for review before sending", () => {
  const view = mount();
  try {
    assert.ok(view.text().includes("'그만'이라고 쓰면 언제든 마칠 수 있어요"));
    view.click("예시로 설명");
    assert.equal(view.input.value, "예시로 설명해 주세요.");
    assert.deepEqual(view.sent, []);
    view.click("보내기 →");
    view.click("나중에 연습");
    assert.equal(view.input.value, "지금은 연습하기 어려워요. 다음에 해볼 방법을 설명해 주세요.");
    assert.equal(view.sent.length, 1);
    view.click("보내기 →");
    assert.deepEqual(view.sent, ["예시로 설명해 주세요.", "지금은 연습하기 어려워요. 다음에 해볼 방법을 설명해 주세요."]);
  } finally { view.unmount(); }
});

test("plain Enter sends the draft; Shift+Enter and IME composition keep typing", () => {
  const view = mount({ initial: "질문" });
  try {
    const press = (init) => react.act(() => view.input.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true, ...init,
    })));
    press({ shiftKey: true });
    press({ isComposing: true });
    assert.deepEqual(view.sent, []);
    press({});
    assert.deepEqual(view.sent, ["질문"]);
  } finally { view.unmount(); }
});

test("waiting or disabled sessions block shortcuts and keyboard submission", () => {
  for (const state of [{ sending: true }, { inputEnabled: false }]) {
    const view = mount({ ...state, initial: "질문" });
    try {
      view.click("예시로 설명");
      view.click("코치에게 질문");
      react.act(() => view.input.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Enter", ctrlKey: true, bubbles: true,
      })));
      assert.equal(view.input.value, "질문");
      assert.deepEqual(view.sent, []);
    } finally { view.unmount(); }
  }
});

// 훅 하나를 붙인 컴포넌트를 jsdom 위에 띄우고, 렌더마다 그 훅이 돌려준 것을 모은다.
// 훅 테스트가 셋이 되면서 같은 서른 줄을 세 번 베끼게 됐다.
//
// 훅 테스트가 순수 함수 테스트와 갈리는 지점이 둘 있고, 여기 담긴 것은 그 둘뿐이다 —
// **아직 다시 그려지기 전**이라는 시점이 존재한다는 것(그래서 act 콜백 안이 곧
// "기다림 뒤에 돌아온 코드" 다), 그리고 훅이 돌려준 것의 **동일성**을 두 렌더에 걸쳐
// 견줄 수 있어야 한다는 것(그것이 이펙트 의존성에 실린다).
//
// react 와 react-dom/client 는 dom-setup 이 전역을 심은 뒤에야 불러올 수 있다.
// 아래 import 순서가 그것을 보장한다.
import { window } from "./dom-setup.mjs";

const react = await import("react");
const { createRoot } = await import("react-dom/client");

export { react, window };

/**
 * @param Probe `onRender` 하나만 받는 fixture 컴포넌트. 훅이 돌려준 것을 그대로 넘긴다.
 */
export function mountProbe(Probe) {
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
     * 마지막 렌더가 준 손잡이로 무언가를 한다. act 는 콜백이 끝난 뒤에 렌더를 흘리므로
     * 콜백 안에서 다시 물으면 "아직 다시 그려지기 전"의 답을 볼 수 있다.
     */
    act: (fn) => {
      let out;
      react.act(() => {
        out = fn(seen.at(-1));
      });
      return out;
    },
    unmount: () => {
      react.act(() => root.unmount());
      container.remove();
    },
  };
}

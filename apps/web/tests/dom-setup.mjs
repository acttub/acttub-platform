// 훅을 실제로 돌려 보기 위한 최소 DOM. 이 파일을 import 한 테스트에만 전역이 생긴다
// (node --test 는 테스트 파일마다 별도 프로세스라 다른 스위트로 새지 않는다).
//
// ⚠ jsdom window 를 통째로 globalThis 에 복사하지 않는다.
//   - `performance` 를 덮으면 Node 내부가 자기 자신을 다시 부르며 RangeError 로 죽는다.
//   - jsdom 의 `FormData` 가 Node 것을 밀어내면 React 19 의 form action 이 깨진다.
// 필요한 것만 골라 심고, 모자라면 그때 하나씩 늘린다.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
});

const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
// react-dom 이 노드 종류를 instanceof 로 가른다. 전역과 window 의 생성자가
// 다르면 그 검사가 전부 빗나간다.
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Text = window.Text;
globalThis.DocumentFragment = window.DocumentFragment;

// React 19.2 에서도 여전히 필요하다. 없으면 act() 가 경고를 내고 큐를 비우지 않는다.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { window };
export const { document } = window;

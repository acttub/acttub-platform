// next/image 자리에 끼우는 대역. 실제 컴포넌트는 CJS 기본 내보내기라 Node ESM 에서 객체로 들어온다.
import { createElement } from "react";

export default function Image({ src, alt }) {
  return createElement("img", { src: typeof src === "string" ? src : src.src, alt });
}

// 화면 테스트가 next/* 를 끌어오는 컴포넌트를 Node 에서 그리게 한다. ts-module-loader.mjs 와 mount-probe.mjs 뒤,
// 대상 컴포넌트를 import 하기 전에 불러온다.
//
// - next/link 는 실제 컴포넌트다. Node ESM 은 확장자 없는 하위 경로를 찾지 못해 .js 로 잇기만 한다.
// - next/image 도 실제 컴포넌트지만 CommonJS 의 default 가 한 겹 더 싸여 있어 벗겨 준다.
// - next/navigation 은 앱 라우터 밖에서 돌지 않는다. 테스트가 경로를 정하고 이동을 읽는 대역으로 바꾼다.
// - 정적 이미지 import(@/assets/*.png)는 번들러가 크기를 채운 객체로 바꾸는 자리다. 같은 모양을 준다.
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { window } from "../dom-setup.mjs";

const require = createRequire(import.meta.url);

/** next/navigation 대역이 읽고 쓰는 상태. 테스트마다 resetNavigation 으로 비운다. */
export const navigation = { pathname: "/", pushed: [] };
globalThis.__featuresNavigation = navigation;

export function resetNavigation(pathname = "/") {
  navigation.pathname = pathname;
  navigation.pushed.length = 0;
}

const imageUrl = pathToFileURL(require.resolve("next/image.js")).href;
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const shims = {
  "next/image": moduleUrl(`import image from ${JSON.stringify(imageUrl)}; export default image.default;`),
  "next/navigation": moduleUrl(`
const nav = globalThis.__featuresNavigation;
const router = { push: (href) => nav.pushed.push(href), replace: (href) => nav.pushed.push(href), back() {}, forward() {}, refresh() {}, prefetch() {} };
export const usePathname = () => nav.pathname;
export const useSearchParams = () => new URLSearchParams(globalThis.location?.search ?? "");
export const useRouter = () => router;
`),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier in shims) return { url: shims[specifier], shortCircuit: true };
    if (specifier.endsWith(".png")) {
      const src = `/${path.basename(specifier)}`;
      return { url: moduleUrl(`export default { src: ${JSON.stringify(src)}, width: 240, height: 64 };`), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// next/link 가 그릴 때 브라우저 전역 self 를 읽는다.
globalThis.self = window;

// next/navigation 자리에 끼우는 대역. 앱 라우터 밖에서는 useSearchParams 가 돌지 않는다.
// Next 는 window.history.pushState·replaceState 를 useSearchParams 와 맞춰 주므로(화면이 주소를
// 갈아끼우는 길이 이것이다) 대역도 jsdom 의 주소를 읽고, 두 함수가 불리면 다시 그린다.
import { useMemo, useSyncExternalStore } from "react";

const listeners = new Set();
let patchedHistory = null;

function watchHistory() {
  const { history } = globalThis.window;
  if (patchedHistory === history) return;
  patchedHistory = history;
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name].bind(history);
    history[name] = (...args) => {
      original(...args);
      for (const listener of listeners) listener();
    };
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSearchParams() {
  watchHistory();
  const search = useSyncExternalStore(subscribe, () => globalThis.window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export const usePathname = () => globalThis.window.location.pathname;
export const useRouter = () => ({ push() {}, replace() {}, back() {}, prefetch() {} });

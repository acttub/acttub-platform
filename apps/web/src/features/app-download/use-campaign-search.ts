"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * 현재 주소의 쿼리를 다운로드 링크에 전달한다. 값은 읽기만 하고 브라우저 저장소나 쿠키에는
 * 복제하지 않는다. 실제 허용목록과 검증은 store-links의 순수 함수가 맡는다.
 */
export function useCampaignSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
}

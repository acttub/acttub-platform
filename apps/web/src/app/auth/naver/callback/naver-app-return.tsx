"use client";

import { useEffect, useSyncExternalStore } from "react";

import { naverAppReturnUrl } from "@/lib/auth/naver-app-return";

function replaceLocation(href: string) {
  window.location.replace(href);
}

// 이 페이지의 주소는 바뀌지 않는다. 프리렌더 때는 빈 값이다.
const subscribe = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => "";

/**
 * 네이버가 돌려보낸 값을 앱으로 바로 넘긴다. 프리렌더한 껍데기라 주소의 값은 브라우저에서 읽는다.
 * 자동 이동이 막히는 브라우저(사용자 동작 없는 앱 스킴 이동)에서도 막다른 길이 되지 않게 같은 주소의
 * 링크를 함께 둔다.
 */
export default function NaverAppReturn({
  navigate = replaceLocation,
}: {
  navigate?: (href: string) => void;
}) {
  const href = naverAppReturnUrl(useSyncExternalStore(subscribe, readSearch, serverSearch));

  // 하이드레이션 첫 렌더의 href 는 프리렌더 값(빈 쿼리)이다. 이동은 실제 주소로 한 번만 한다.
  useEffect(() => {
    navigate(naverAppReturnUrl(window.location.search));
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="text-center">
        <p className="text-base font-semibold text-[#4e5968]">앱으로 돌아가는 중이에요.</p>
        <a href={href} className="mt-3 inline-block text-sm font-semibold text-[#3182f6]">
          앱으로 돌아가기
        </a>
      </div>
    </main>
  );
}

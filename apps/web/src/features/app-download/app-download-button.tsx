"use client";

import { useSyncExternalStore } from "react";

import {
  APP_DOWNLOAD_ATTR,
  detectMobileOs,
  downloadHrefFor,
  type MobileOs,
  type StoreLinkSurface,
} from "@/lib/app-download/store-links";

// 기기는 한 번만 판별하면 된다 — 브라우저를 쓰는 도중에 바뀌지 않는다.
let detected: MobileOs | null | undefined;

function clientHref(surface: StoreLinkSurface): string {
  if (detected === undefined) {
    detected = detectMobileOs(navigator.userAgent, navigator.maxTouchPoints);
  }
  return downloadHrefFor(detected, surface);
}

// 값이 바뀔 일이 없으니 구독은 빈 껍데기다. 모듈 상수로 둬서 렌더마다 다시 구독하지 않는다.
const subscribe = () => () => {};

// 높이·모서리·글자 크기는 여기서만 정한다 — className 으로 h-* 를 덧씌우면 Tailwind 가
// 어느 쪽을 이기게 할지 보장하지 않아서 자리마다 크기가 흔들린다.
const SIZE_CLASS = {
  sm: "h-12 rounded-[14px] px-5 text-[15px]",
  md: "h-14 rounded-2xl px-7 text-base",
  lg: "h-[60px] rounded-[18px] px-7 text-lg",
} as const;

/**
 * 기기에 맞는 스토어로 바로 보내는 버튼.
 *
 * 페이지가 빌드 시점에 굳는 정적 프리렌더라 기기는 하이드레이션 뒤에야 알 수 있다.
 * 그래서 서버 스냅샷은 두 스토어를 다 보여주는 `/app` 이고, 하이드레이션이 끝나면
 * 아이폰은 App Store, 안드로이드는 Google Play 로 주소만 갈아 끼운다. 버튼은 처음부터
 * 같은 자리에 같은 글자로 있으므로 자리도 크기도 흔들리지 않고, 판별 전에 눌러도
 * `/app` 에서 두 배지를 만나니 막다른 길이 아니다.
 *
 * useEffect + setState 대신 useSyncExternalStore 를 쓴다 — React 컴파일러 규칙이
 * effect 안의 setState 를 막고, 서버와 클라이언트 값이 다른 경우가 정확히 이 훅의 자리다.
 * next/link 를 쓰지 않는 이유는 주소가 외부 스토어로 바뀌기 때문이다.
 */
export function AppDownloadButton({
  surface,
  size = "md",
  className = "",
}: {
  surface: StoreLinkSurface;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const href = useSyncExternalStore(
    subscribe,
    () => clientHref(surface),
    () => "/app",
  );

  return (
    <a
      href={href}
      // 하이드레이션 전에 인라인 스크립트가 이 표식을 보고 주소를 먼저 고친다.
      {...{ [APP_DOWNLOAD_ATTR]: surface }}
      className={`inline-flex items-center justify-center bg-[#3182f6] font-black text-white shadow-[0_18px_40px_rgba(49,130,246,0.28)] transition hover:-translate-y-0.5 hover:bg-[#1b64da] ${SIZE_CLASS[size]} ${className}`}
    >
      앱 다운받기
    </a>
  );
}

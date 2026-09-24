"use client";

import { detectMobileOs } from "@/lib/app-download/store-links";

import { openInAppTarget } from "./open-in-app";

/** 앱이 열려 페이지가 가려졌는지 보기 전에 기다리는 시간. 앱 전환 애니메이션보다 길어야 한다. */
const APP_OPEN_WAIT_MS = 1500;

/**
 * "앱에서 보기". 기본 주소는 두 스토어를 다 보여 주는 `/app` 이라 JS 가 돌기 전에 눌러도 막다른 길이
 * 아니다. 누르면 기기를 보고 앱 주소를 연다 — iOS 는 앱이 없으면 페이지가 그대로 보이므로 잠시 뒤에도
 * 보이면 스토어로 보내고, 안드로이드는 intent 주소가 스스로 스토어로 넘어간다.
 */
export function OpenInAppButton({ entryId }: { entryId: string }) {
  function open(event: React.MouseEvent<HTMLAnchorElement>) {
    const os = detectMobileOs(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    const target = openInAppTarget(os, entryId, window.location.origin);
    event.preventDefault();
    window.location.href = target.href;
    const fallback = target.fallback;
    if (!fallback) return;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") window.location.href = fallback;
    }, APP_OPEN_WAIT_MS);
  }

  return (
    <a
      href="/app"
      onClick={open}
      className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] text-base font-bold text-white transition-colors hover:bg-[#1b64da]"
    >
      앱에서 보기
    </a>
  );
}

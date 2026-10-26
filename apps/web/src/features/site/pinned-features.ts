"use client";

import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

/**
 * 공개 홈 기능 구간의 데스크톱 고정 화면(토스식). 구간 높이는 기능 수 × 한 화면이고, 그 안에서
 * 한 화면짜리 무대가 머리 아래에 붙어 있다. 스크롤한 만큼 무대 안의 글과 휴대폰이 다음 기능으로 바뀐다.
 * 화면 틀은 그대로라 칸이 딱 떨어지고, 휠은 가로채지 않는다.
 */

export const PINNED_MEDIA = "(min-width: 1024px)";
/** sm 이상 머리(SiteHeader) 높이 */
export const PINNED_HEADER = 72;

/** 무대가 붙은 뒤 스크롤한 거리(offset)를 한 화면(step) 단위로 반올림해 지금 보일 기능을 고른다. */
export function featureIndexAt(offset: number, step: number, count: number): number {
  if (count <= 0 || step <= 0) return 0;
  return Math.min(Math.max(Math.round(offset / step), 0), count - 1);
}

function subscribeMedia(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(PINNED_MEDIA);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readMedia(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PINNED_MEDIA).matches;
}

/** 데스크톱이면 true. 서버 렌더와 첫 그림은 폰 배치(false)다. */
export function usePinnedDesktop(): boolean {
  return useSyncExternalStore(subscribeMedia, readMedia, () => false);
}

/** 지금 무대에 보일 기능 번호 */
export function usePinnedFeature(sectionRef: RefObject<HTMLElement | null>, count: number, desktop: boolean): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!desktop) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = sectionRef.current;
      if (!el) return;
      const step = window.innerHeight - PINNED_HEADER;
      setActive(featureIndexAt(PINNED_HEADER - el.getBoundingClientRect().top, step, count));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sectionRef, count, desktop]);
  return desktop ? active : 0;
}

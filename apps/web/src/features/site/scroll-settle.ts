"use client";

import { useEffect } from "react";

/**
 * 공개 홈 데스크톱의 "멈춘 뒤 맞춤". 스크롤은 브라우저 기본 그대로 두고, 손을 멈췄을 때
 * 어떤 구간(data-snap)의 윗부분이 머리 근처에 걸쳐 있으면 그 구간이 머리 바로 아래에 오도록 부드럽게 맞춘다.
 * 멀리 떨어진 곳에서 멈추면 건드리지 않는다. 휠을 가로채지 않는다. 폰·움직임 줄이기에서는 끈다.
 */

export const SETTLE_MEDIA = "(min-width: 1024px) and (min-height: 640px)";
/** sm 이상 머리(SiteHeader) 높이 */
export const SETTLE_HEADER = 72;
/** 구간 윗부분이 화면 높이의 이 비율 안쪽에 걸쳐 있을 때만 맞춘다. */
export const SETTLE_RANGE = 0.3;
/** 스크롤이 이만큼 조용하면 멈춘 것으로 본다(scrollend 를 못 쓰는 브라우저용). */
const IDLE_MS = 160;

/**
 * 지금 위치 y 에서 맞출 위치. points 는 각 구간이 머리 바로 아래에 오는 scrollY 들.
 * 가장 가까운 자리가 range(px) 안이면 그 자리, 이미 맞거나 멀면 null.
 */
export function settleTarget(points: number[], y: number, range: number, maxScroll: number): number | null {
  let best: number | null = null;
  for (const p of points) {
    const target = Math.min(Math.max(p, 0), maxScroll);
    const d = Math.abs(target - y);
    if (d <= range && (best === null || d < Math.abs(best - y))) best = target;
  }
  if (best === null || Math.abs(best - y) < 2) return null;
  return best;
}

export function useScrollSettle(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SETTLE_MEDIA);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;
    let pointerDown = false;

    const settle = () => {
      if (!media.matches || reduce.matches || pointerDown) return;
      const points = [...document.querySelectorAll<HTMLElement>("[data-snap]")].map(
        (el) => el.getBoundingClientRect().top + window.scrollY - SETTLE_HEADER,
      );
      const viewport = window.innerHeight - SETTLE_HEADER;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // 맨 아래(바닥 정보)에 닿아 있으면 맞추지 않는다.
      if (window.scrollY >= max - 2) return;
      const target = settleTarget(points, window.scrollY, viewport * SETTLE_RANGE, max);
      if (target !== null) window.scrollTo({ top: target, behavior: "smooth" });
    };

    const hasScrollEnd = "onscrollend" in window;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, IDLE_MS);
    };
    const onScrollEnd = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 60);
    };
    const onPointerDown = () => {
      pointerDown = true;
    };
    const onPointerUp = () => {
      pointerDown = false;
    };

    if (hasScrollEnd) window.addEventListener("scrollend", onScrollEnd);
    else window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);
}

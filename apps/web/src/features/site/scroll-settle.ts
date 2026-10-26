"use client";

import { useEffect } from "react";

/**
 * 공개 홈 데스크톱의 "멈춘 뒤 맞춤". 스크롤은 브라우저 기본 그대로 두고, 손을 멈췄을 때 구간(data-snap)이
 * 머리 밑에 반쯤 걸려 있으면 가던 방향으로 맞춘다. 조금만 움직였으면 원래 구간으로, 그보다 더 움직였으면
 * 다음(또는 이전) 구간 시작으로 부드럽게 간다. 그래서 멈춘 화면이 늘 구간 시작에 딱 맞는다.
 * 화면보다 훨씬 긴 칸(맨 아래 등)은 경계 가까이에서만 맞춘다. 휠은 가로채지 않는다. 폰·움직임 줄이기에서는 끈다.
 */

export const SETTLE_MEDIA = "(min-width: 1024px) and (min-height: 640px)";
/** sm 이상 머리(SiteHeader) 높이 */
export const SETTLE_HEADER = 72;
/** 칸 높이의 이 비율보다 적게 움직였으면 원래 칸으로 되돌린다. */
export const SETTLE_COMMIT = 0.15;
/** 화면보다 긴 칸에서는 경계에서 화면 높이의 이 비율 안쪽일 때만 맞춘다. */
export const SETTLE_EDGE = 0.3;
/** 스크롤이 이만큼 조용하면 멈춘 것으로 본다(scrollend 를 못 쓰는 브라우저용). */
const IDLE_MS = 160;

/**
 * 멈춘 위치 y 에서 맞출 위치. points 는 각 칸이 머리 바로 아래에 오는 scrollY 들(작은 순),
 * dir 은 마지막으로 움직인 방향(1 아래, -1 위, 0 모름), viewport 는 머리 아래 화면 높이.
 * 이미 맞거나 맞출 필요가 없으면 null.
 */
export function settleTarget(points: number[], y: number, dir: number, viewport: number, maxScroll: number): number | null {
  const pts = [...new Set(points.map((p) => Math.min(Math.max(Math.round(p), 0), Math.max(maxScroll, 0))))].sort(
    (a, b) => a - b,
  );
  if (pts.length === 0) return null;
  if (pts.some((p) => Math.abs(p - y) < 2)) return null;
  let i = -1;
  for (let k = 0; k < pts.length; k++) if (pts[k] <= y) i = k;
  const prev = i >= 0 ? pts[i] : null;
  const next = i + 1 < pts.length ? pts[i + 1] : null;
  if (prev === null) return next !== null && next - y <= viewport * SETTLE_EDGE ? next : null;
  if (next === null) return y - prev <= viewport * SETTLE_EDGE ? prev : null;
  const gap = next - prev;
  if (gap > viewport * 1.25) {
    // 화면보다 훨씬 긴 칸: 경계 가까이에서만 가까운 쪽으로.
    if (y - prev <= viewport * SETTLE_EDGE) return prev;
    if (next - y <= viewport * SETTLE_EDGE) return next;
    return null;
  }
  const moved = (y - prev) / gap;
  if (dir > 0) return moved > SETTLE_COMMIT ? next : prev;
  if (dir < 0) return 1 - moved > SETTLE_COMMIT ? prev : next;
  return moved < 0.5 ? prev : next;
}

export function useScrollSettle(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SETTLE_MEDIA);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;
    let pointerDown = false;
    let lastY = window.scrollY;
    let dir = 0;
    /** 우리가 맞추는 중이면 그 목표. 그 스크롤은 방향 계산에 넣지 않는다. */
    let settling: number | null = null;

    const settle = () => {
      if (!media.matches || reduce.matches || pointerDown) return;
      const y = window.scrollY;
      if (settling !== null) {
        const reached = Math.abs(y - settling) < 2;
        settling = null;
        if (reached) return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (y >= max - 2) return;
      const points = [...document.querySelectorAll<HTMLElement>("[data-snap]")].map(
        (el) => el.getBoundingClientRect().top + window.scrollY - SETTLE_HEADER,
      );
      const target = settleTarget(points, y, dir, window.innerHeight - SETTLE_HEADER, max);
      if (target === null) return;
      settling = target;
      window.scrollTo({ top: target, behavior: "smooth" });
    };

    const hasScrollEnd = "onscrollend" in window;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, ms);
    };
    const onScroll = () => {
      const y = window.scrollY;
      if (settling === null && Math.abs(y - lastY) > 0.5) dir = y > lastY ? 1 : -1;
      lastY = y;
      if (!hasScrollEnd) schedule(IDLE_MS);
    };
    const onScrollEnd = () => schedule(60);
    // 휠·키로 직접 움직이기 시작하면 우리가 맞추던 것은 끝난 것으로 본다.
    const onUserInput = () => {
      settling = null;
    };
    const onPointerDown = () => {
      pointerDown = true;
    };
    const onPointerUp = () => {
      pointerDown = false;
      schedule(IDLE_MS);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    if (hasScrollEnd) window.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("wheel", onUserInput, { passive: true });
    window.addEventListener("keydown", onUserInput);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("wheel", onUserInput);
      window.removeEventListener("keydown", onUserInput);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);
}

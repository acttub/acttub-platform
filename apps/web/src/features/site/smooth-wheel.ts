"use client";

import { useEffect } from "react";

/**
 * 공개 홈 데스크톱의 부드러운 휠 스크롤(Lenis 방식). 휠·트랙패드 입력만큼 목표 위치를 옮기고,
 * 화면은 매 프레임 남은 거리의 일정 비율씩 따라가서 딱딱 끊기지 않고 미끄러지듯 멈춘다.
 * 칸에 맞춰 멈추거나 넘기지는 않는다(가는 거리는 입력한 만큼).
 * 키보드·스크롤바·주소 이동은 브라우저 기본 그대로 두고 위치만 맞춘다. 폰·움직임 줄이기에서는 끈다.
 */

export const SMOOTH_MEDIA = "(min-width: 1024px) and (pointer: fine)";
/** 60fps 한 프레임에 남은 거리 중 따라가는 비율(Lenis 기본 lerp 0.1) */
const LERP = 0.1;

/** 휠 값을 px 로 맞춘다(줄 단위·쪽 단위 입력 대비). */
export function wheelPixels(delta: number, mode: number, pageHeight: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * pageHeight;
  return delta;
}

/** dt(ms) 동안 current 가 target 을 따라간 다음 위치. 프레임 속도와 상관없이 같은 느낌이 되게 지수로 맞춘다. */
export function followScroll(current: number, target: number, dtMs: number): number {
  const k = 1 - Math.pow(1 - LERP, dtMs / (1000 / 60));
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.5 ? target : next;
}

/** 안쪽에서 따로 스크롤되는 상자 위라면 그 상자에 맡긴다. */
function insideScrollable(target: EventTarget | null, dy: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function useSmoothWheel(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SMOOTH_MEDIA);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current = window.scrollY;
    let target = current;
    let frame = 0;
    let last = 0;
    let moving = false;

    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

    const step = (now: number) => {
      const dt = last ? Math.min(now - last, 64) : 1000 / 60;
      last = now;
      current = followScroll(current, target, dt);
      window.scrollTo(0, current);
      if (current !== target) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        last = 0;
        moving = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!media.matches || reduce.matches || e.ctrlKey || e.defaultPrevented) return;
      const dy = wheelPixels(e.deltaY, e.deltaMode, window.innerHeight);
      if (Math.abs(dy) <= Math.abs(e.deltaX) || insideScrollable(e.target, dy)) return;
      e.preventDefault();
      if (!moving) current = target = window.scrollY;
      target = Math.min(Math.max(target + dy, 0), maxScroll());
      moving = true;
      if (!frame) frame = requestAnimationFrame(step);
    };

    // 키보드·스크롤바·주소 이동처럼 휠이 아닌 스크롤은 그대로 두고 따라갈 위치만 맞춘다.
    const onScroll = () => {
      if (!moving) current = target = window.scrollY;
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      moving = false;
      current = target = window.scrollY;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", stop);
    window.addEventListener("pointerdown", stop);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("pointerdown", stop);
    };
  }, []);
}

"use client";

import { useEffect } from "react";

/**
 * 공개 홈(/)의 데스크톱 구간 넘김. 휠·트랙패드를 한 번 내리면 중간에 멈추지 않고
 * 다음 구간(data-snap)이 머리 바로 아래에 올 때까지 부드럽게 내려간다. 올릴 때도 같다.
 *
 * CSS scroll-snap 은 트랙패드로 살짝 밀면 제자리로 돌아오거나 가다가 멈춰서 쓰지 않는다.
 * 화면보다 긴 구간은 그 안에서 평소처럼 내려가고, 끝에 닿은 뒤 다음 손짓에 넘어간다.
 * 폰·낮은 창·움직임 줄이기 설정에서는 켜지 않는다.
 */

export const PAGING_MEDIA = "(min-width: 1024px) and (min-height: 640px)";
/** sm 이상 머리(SiteHeader) 높이 */
export const PAGING_HEADER = 72;
const DURATION_MS = 700;
/**
 * 손짓 하나로 보는 휠 이벤트 간격. 이보다 오래 쉬어야 다음 손짓이다.
 * 트랙패드는 손을 뗀 뒤에도 관성 이벤트가 1초 넘게 이어지고, 맥의 마우스 휠도 한 칸에
 * 여러 이벤트가 온다. 그래서 넘기는 중이든 넘긴 뒤든 이벤트가 이어지는 동안은 다시 넘기지 않는다.
 */
const GESTURE_GAP_MS = 240;
const EDGE = 2;

/** 멈출 자리(문서 기준 scrollY)들을 작은 순서로. 겹치는 자리는 하나로 친다. */
export function snapPoints(tops: number[], maxScroll: number): number[] {
  const pts = tops.map((t) => Math.min(Math.max(Math.round(t), 0), Math.max(maxScroll, 0)));
  pts.push(Math.max(maxScroll, 0));
  return [...new Set(pts)].sort((a, b) => a - b);
}

/**
 * 지금 위치 y 에서 dir(1 아래, -1 위)로 손짓했을 때 갈 자리.
 * - 화면보다 긴 구간 안이라 아직 그 구간 끝에 안 닿았으면 "native"(평소 스크롤).
 * - 더 갈 곳이 없으면 null.
 */
export function pagingTarget(points: number[], y: number, dir: 1 | -1, viewport: number): number | "native" | null {
  if (points.length === 0) return null;
  // 지금 보고 있는 구간: 시작이 y 이하인 마지막 자리.
  let i = 0;
  for (let k = 0; k < points.length; k++) if (points[k] <= y + EDGE) i = k;
  const start = points[i];
  const next = points[i + 1];
  const tall = next !== undefined && next - start > viewport + EDGE;
  if (dir === 1) {
    if (next === undefined) return null;
    return tall && y + viewport < next - EDGE ? "native" : next;
  }
  // 구간 중간이면 긴 구간은 평소처럼 올리고, 아니면 그 구간 시작으로 맞춘다.
  if (y > start + EDGE) return tall ? "native" : start;
  return i > 0 ? points[i - 1] : null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function useSectionPaging(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PAGING_MEDIA);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animating = false;
    let lastWheel = 0;
    let gestureUsed = false;
    let frame = 0;

    const points = () => {
      const tops = [...document.querySelectorAll<HTMLElement>("[data-landing-snap] [data-snap]")]
        .filter((el) => el.dataset.snap !== "end")
        .map((el) => el.getBoundingClientRect().top + window.scrollY - PAGING_HEADER);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return snapPoints(tops, max);
    };

    const animateTo = (to: number) => {
      const from = window.scrollY;
      if (Math.abs(to - from) < 1) return;
      animating = true;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - t0) / DURATION_MS, 1);
        window.scrollTo(0, from + (to - from) * easeInOutCubic(t));
        if (t < 1) frame = requestAnimationFrame(step);
        else animating = false;
      };
      frame = requestAnimationFrame(step);
    };

    /** 넘겼으면 true, 평소 스크롤에 맡기면 false */
    const page = (dir: 1 | -1): boolean => {
      const target = pagingTarget(points(), window.scrollY, dir, window.innerHeight - PAGING_HEADER);
      if (target === "native") return false;
      if (target !== null) animateTo(target);
      return true;
    };

    const onWheel = (e: WheelEvent) => {
      if (!media.matches || reduce.matches || e.ctrlKey) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const now = performance.now();
      // 이벤트가 끊김 없이 이어지면 같은 손짓(관성 포함)이다. 값이 다시 커져도 새 손짓으로 보지 않는다
      // — 맥 휠 한 칸·트랙패드 시작은 값이 커지며 와서, 그렇게 보면 한 번에 두 칸 넘어간다.
      if (now - lastWheel > GESTURE_GAP_MS) gestureUsed = false;
      lastWheel = now;
      const dir: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      if (animating || gestureUsed) {
        e.preventDefault();
        return;
      }
      if (page(dir)) {
        e.preventDefault();
        gestureUsed = true;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!media.matches || reduce.matches || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const down = e.key === "PageDown" || e.key === "ArrowDown" || (e.key === " " && !e.shiftKey);
      const up = e.key === "PageUp" || e.key === "ArrowUp" || (e.key === " " && e.shiftKey);
      if (!down && !up) return;
      // 키를 누르고 있으면 반복 입력이 온다. 한 번 누름에 한 칸만 넘긴다.
      if (animating || e.repeat) {
        e.preventDefault();
        return;
      }
      if (page(down ? 1 : -1)) e.preventDefault();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

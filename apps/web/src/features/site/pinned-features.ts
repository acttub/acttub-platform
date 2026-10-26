"use client";

import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

/**
 * 공개 홈 기능 구간의 데스크톱 고정 무대(토스식). 한 화면짜리 무대가 머리 아래에 붙어 있고,
 * 스크롤하는 만큼 글과 휴대폰 화면이 그 자리에서 이어서 움직이며 다음 기능으로 넘어간다(스크롤에 묶인 장면 전환).
 * 휠은 가로채지 않는다. 움직임은 transform·opacity 만 바꿔 버벅이지 않게 한다.
 */

export const PINNED_MEDIA = "(min-width: 1024px)";
/** sm 이상 머리(SiteHeader) 높이 */
export const PINNED_HEADER = 72;
/** 기능 하나를 넘기는 데 드는 스크롤 = 무대 높이 × 이 비율. 작을수록 조금만 내려도 넘어간다. */
export const SCENE_STEP = 0.6;

/** 무대가 붙은 뒤 스크롤한 거리(offset)를 기능 단위 진행도(0 ~ count-1, 소수)로 바꾼다. */
export function sceneProgress(offset: number, step: number, count: number): number {
  if (count <= 1 || step <= 0) return 0;
  return Math.min(Math.max(offset / step, 0), count - 1);
}

/**
 * 진행도 p 에서 i 번째 장면의 보이는 정도와 세로 이동(px). 가까울수록 또렷하고 제자리.
 * fade 가 클수록 빨리 사라진다. 글은 겹치면 지저분해서 빠르게(1.6), 휴대폰 화면은 겹쳐도 되니
 * 1 로 둬서 바뀌는 중간에도 화면이 비어 보이지 않게 한다.
 */
export function sceneLook(p: number, i: number, travel: number, fade = 1.6): { opacity: number; y: number } {
  const d = i - p;
  const opacity = Math.min(Math.max(1 - Math.abs(d) * fade, 0), 1);
  return { opacity, y: Math.max(Math.min(d, 1), -1) * travel };
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

/**
 * 스크롤에 맞춰 무대 안 장면([data-scene] + data-scene-index, 이동 폭 data-scene-travel, 사라지는 빠르기 data-scene-fade)을 직접 움직이고,
 * 지금 가장 또렷한 기능 번호를 돌려준다(버튼 막기·표시용). 번호가 바뀔 때만 다시 그린다.
 */
export function usePinnedScenes(sectionRef: RefObject<HTMLElement | null>, count: number, desktop: boolean): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const scenes = [...el.querySelectorAll<HTMLElement>("[data-scene]")];
    if (!desktop) {
      for (const s of scenes) {
        s.style.opacity = "";
        s.style.transform = "";
      }
      return;
    }
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const update = () => {
      frame = 0;
      const step = (window.innerHeight - PINNED_HEADER) * SCENE_STEP;
      const p = sceneProgress(PINNED_HEADER - el.getBoundingClientRect().top, step, count);
      const current = Math.round(p);
      for (const s of scenes) {
        const i = Number(s.dataset.sceneIndex);
        if (reduce) {
          s.style.opacity = i === current ? "1" : "0";
          s.style.transform = "";
          continue;
        }
        const look = sceneLook(p, i, Number(s.dataset.sceneTravel ?? 40), Number(s.dataset.sceneFade ?? 1.6));
        s.style.opacity = String(look.opacity);
        s.style.transform = `translate3d(0, ${look.y.toFixed(1)}px, 0)`;
      }
      setActive(current);
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

"use client";

import { useEffect, useState } from "react";

import { AppDownloadButton } from "./app-download-button";

const COPY = {
  title: "Acttub 앱",
  detail: "iOS · Android 무료",
} as const;

export function StickyDownloadBar({ heroId }: { heroId: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const hero = document.getElementById(heroId);
    if (!hero) return;

    // 스냅 스크롤은 히어로 아랫변을 화면 윗변에 정확히 맞춘다. 그 상태를 IntersectionObserver 는
    // "닿아 있다 = 보인다" 로 치기 때문에 바가 영영 안 뜬다. 관찰 영역 위쪽을 헤더 높이만큼
    // 줄여서, 히어로가 헤더 밑으로 들어간 순간부터 "안 보인다" 로 본다.
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(!entry.isIntersecting);
      },
      { rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(hero);

    return () => observer.disconnect();
  }, [heroId]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-[#edf0f3] bg-white/95 px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(25,31,40,0.1)] backdrop-blur-xl transition-transform duration-300 sm:hidden ${visible ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] font-black text-[#191f28]">{COPY.title}</p>
          <p className="mt-0.5 text-xs font-medium text-[#8b95a1]">
            {COPY.detail}
          </p>
        </div>
        <AppDownloadButton
          surface="landing_sticky"
          size="sm"
          className="shrink-0"
        />
      </div>
    </div>
  );
}

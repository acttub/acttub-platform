"use client";

import { useEffect, useState } from "react";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import {
  APP_DOWNLOAD_ATTR,
  type StoreLinkSurface,
} from "@/lib/app-download/store-links";

/**
 * 입시 목록·학교 상세에서 실기 연습으로 앱을 잇는 안내 칸. 주소는 다른 다운로드 버튼과 같은
 * 규칙(useAppDownloadHref + 하이드레이션 전 bootstrap 표식)을 쓴다.
 */
export function PracticeCallout({
  id,
  eyebrow,
  title,
  body,
  action,
  surface,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  surface: StoreLinkSurface;
}) {
  const href = useAppDownloadHref(surface);
  return (
    <section
      id={id}
      className="mt-6 rounded-2xl border border-[#c9dcf8] bg-[#e8f3ff] px-5 py-5"
    >
      <p className="text-[12px] font-black text-[#3182f6]">{eyebrow}</p>
      <h2 className="mt-1 text-[17px] font-black tracking-[-0.02em] text-[#191f28]">
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] font-semibold leading-6 text-[#4e5968]">{body}</p>
      <a
        href={href}
        {...{ [APP_DOWNLOAD_ATTR]: surface }}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-[#3182f6] px-5 text-[14px] font-black text-white transition hover:bg-[#1b64da]"
      >
        {action}
      </a>
    </section>
  );
}

/**
 * 모바일 폭에서만, 안내 칸이 화면 위로 지나간 뒤 아래에 붙는 버튼. 팝업이 아니라 자리만
 * 차지하는 한 줄이다. 이 버튼이 푸터를 가리지 않게 SiteLayout의 `stickyBottomSpace`를 함께 켠다.
 */
export function StickyPracticeButton({
  anchorId,
  action,
  surface,
}: {
  anchorId: string;
  action: string;
  surface: StoreLinkSurface;
}) {
  const href = useAppDownloadHref(surface);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const anchor = document.getElementById(anchorId);
    if (!anchor) return;
    // 안내 칸이 아직 아래에 있을 때는 숨긴다. 화면 위로 지나간 뒤에만 띄운다.
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchorId]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-[#edf0f3] bg-white/95 px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-xl transition-transform duration-300 sm:hidden ${visible ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
    >
      <a
        href={href}
        tabIndex={visible ? undefined : -1}
        {...{ [APP_DOWNLOAD_ATTR]: surface }}
        className="mx-auto flex h-12 max-w-md items-center justify-center rounded-[14px] bg-[#3182f6] text-[15px] font-black text-white"
      >
        {action}
      </a>
    </div>
  );
}

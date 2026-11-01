"use client";

import type { ReactNode } from "react";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { trackTrialAppClick, type TrialFeature } from "@/lib/analytics/ga";
import { APP_DOWNLOAD_ATTR } from "@/lib/app-download/store-links";
import { useTrialGuest } from "./use-trial-guest";

export const TRIAL_BAR_LABEL = "체험 중";
export const TRIAL_BAR_NOTE = "가입 없이 쓰고 있어요";

/**
 * 가입 없이 체험하는 동안 화면 맨 위에 붙는 얇은 띠. 회원에게는 그리지 않는다.
 * 사이트 머리를 따로 만들지 않고, 리딩 실행·코칭 화면의 기존 틀 위에 한 줄만 얹는다.
 */
export function TrialBar({
  feature,
  note = TRIAL_BAR_NOTE,
  action,
}: {
  feature: TrialFeature;
  note?: string;
  /** 「앱 받기」 왼쪽에 놓는 작은 링크(예: 리딩 배역 바꾸기) */
  action?: ReactNode;
}) {
  const guest = useTrialGuest();
  const appHref = useAppDownloadHref("trial_bar");
  if (!guest) return null;
  return (
    <div role="region" aria-label="체험 안내" className="flex h-11 shrink-0 items-center justify-between gap-3 bg-[#191f28] px-4 text-[13px] text-white sm:px-5">
      <p className="min-w-0 truncate">
        <b className="font-extrabold text-[#9ec5ff]">{TRIAL_BAR_LABEL}</b>
        <span className="text-[#d1d6db]"> · {note}</span>
      </p>
      <div className="flex shrink-0 items-center gap-3">
      {action}
      <a
        href={appHref}
        {...{ [APP_DOWNLOAD_ATTR]: "trial_bar" }}
        onClick={() => trackTrialAppClick(feature, "bar")}
        className="inline-flex h-8 shrink-0 items-center rounded-[10px] bg-[#e8f3ff] px-3.5 text-[13px] font-bold text-[#1b64da] transition hover:bg-[#d9eaff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        앱 받기
      </a>
      </div>
    </div>
  );
}

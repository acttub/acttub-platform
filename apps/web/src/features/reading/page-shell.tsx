"use client";

import type { ReactNode } from "react";

import { AppRail } from "@/features/nav/app-rail";

/**
 * 리딩 화면의 바깥 틀. 준비 화면(대본·배역·완료)은 다른 화면처럼 상단 네비(AppRail)를 달고
 * 가운데 폭을 제한한다. 리딩 실행 화면(wide)은 자기 머리(나가기·진행)를 갖고 전체 폭을 쓴다 —
 * 바가 두 줄이 되지 않게 그때는 네비를 숨긴다.
 */
export function Page({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="min-h-svh flex flex-col">
      {!wide && <AppRail />}
      <main className={`flex-1 flex flex-col w-full ${wide ? "" : "md:max-w-[960px] md:mx-auto md:px-5 md:py-8"} ${className}`}>{children}</main>
    </div>
  );
}

export function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

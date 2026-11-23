"use client";

import Image from "next/image";
import Link from "next/link";

import { useAppDownloadHref } from "./app-download-button";
import { StoreBadges } from "./store-badges";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

/**
 * 랜딩 첫 화면의 앱 설치 묶음(SOMA-1087). 웹에서는 코칭·리딩을 하지 않으므로 모든 진입을 앱 설치로 보낸다.
 * 모바일은 설치 버튼, 데스크톱은 QR 과 스토어 배지, 그리고 로그인 링크. 귀속은 StoreBadges·/go/ios|android/landing_hero 를 그대로 쓴다.
 */
export function HeroAppInstall({ align = "left" }: { align?: "left" | "center" }) {
  const appHref = useAppDownloadHref("landing_hero");
  return (
    <>
      <a
        href={appHref}
        data-app-download="landing_hero"
        className={`mt-7 flex h-14 w-full items-center justify-center rounded-[14px] bg-[#4880ee] text-[17px] font-bold text-white lg:hidden ${FOCUS}`}
      >
        앱 열기 · 무료로 설치
      </a>

      <div className="mt-9 hidden w-fit items-center gap-5 rounded-[22px] border border-[#edf0f3] bg-white p-[18px] pr-6 shadow-[0_6px_24px_rgba(72,128,238,0.08)] lg:flex">
        <Image
          src="/site/app-qr.svg"
          alt="앱 설치 QR 코드"
          width={112}
          height={112}
          unoptimized
          className="rounded-xl border border-[#e5e8eb] bg-white p-2"
        />
        <div>
          <p className="text-[17px] font-extrabold">휴대폰 카메라로 찍으면 설치 화면으로 가요</p>
          <p className="mt-1 text-sm text-[#6b7684]">iPhone · Android 무료</p>
          <StoreBadges surface="landing_hero" className="mt-3" />
        </div>
      </div>

      <p className={`mt-4 text-center text-[15px] font-semibold text-[#4e5968] lg:mt-5 ${align === "left" ? "lg:text-left" : ""} lg:text-base`}>
        계정이 있나요?{" "}
        <Link href="/login" className={`rounded font-bold text-[#3268d8] hover:underline ${FOCUS}`}>
          로그인
        </Link>
      </p>
    </>
  );
}

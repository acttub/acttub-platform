import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import wordmark from "@/assets/acttub-wordmark.png";

/** Pro 안내·환불 페이지 공용 조각. 색과 폰 틀은 홈 랜딩(landing-client.tsx)과 맞춘다. */

export function ProTopBar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
      <Link href="/" aria-label="ACTTUB 홈">
        <Image src={wordmark} alt="Acttub" className="h-6 w-auto" priority />
      </Link>
      <Link
        href={backHref}
        className="inline-flex h-9 items-center rounded-full border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#191f28] transition hover:bg-[#f2f4f6]"
      >
        {backLabel}
      </Link>
    </header>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`}>
      <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.16" />
      <path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative mx-auto flex aspect-[330/640] w-[300px] flex-col gap-3 overflow-hidden rounded-[48px] border-[10px] border-[#191f28] bg-white p-5 pt-6 shadow-[0_30px_70px_rgba(25,31,40,0.22)] ${className}`}
    >
      <span className="mx-auto h-1.5 w-[72px] shrink-0 rounded-full bg-[#333d4b]" />
      {children}
    </div>
  );
}

/** 홈 랜딩 폰 목업과 같은 장면·질문·답변 문구(랜딩 COPY.phone)를 쓴다. */
export function CoachingPhone({ className = "" }: { className?: string }) {
  return (
    <PhoneFrame className={className}>
      <div className="flex items-center gap-3">
        <div className="h-[54px] w-[80px] shrink-0 rounded-xl bg-gradient-to-br from-[#4e5968] to-[#dbeafe]" />
        <div className="min-w-0">
          <p className="text-[14px] font-black leading-5">이별 통보 직후, 카페에서</p>
          <p className="mt-0.5 text-xs font-bold text-[#3182f6]">연습 영상</p>
        </div>
      </div>
      <span className="self-start rounded-full bg-[#e8f3ff] px-3 py-1 text-[12px] font-black text-[#3182f6]">질문 04 / 07</span>
      <div className="rounded-[18px] rounded-bl-[6px] border border-[#edf0f3] bg-[#f9fafb] p-3.5">
        <p className="text-[13px] font-bold leading-5 text-[#6b7684]">말을 끝낸 뒤 시선이 아래로 내려가는 순간이 보여요.</p>
        <p className="mt-1.5 text-[17px] font-black leading-6 text-[#191f28]">그때 인물은 무엇을 기다리고 있었나요?</p>
      </div>
      <div className="ml-auto max-w-[230px] rounded-[18px] rounded-tr-[6px] bg-[#3182f6] px-3.5 py-2.5 text-[14px] font-bold leading-relaxed text-white">
        확신이 아니라… 상대가 한 번만 더 확인해 주길 바랐어요.
      </div>
      <div className="mt-auto rounded-[18px] bg-white p-3.5 shadow-[0_12px_30px_rgba(49,130,246,0.22)] ring-1 ring-[#e8f3ff]">
        <p className="text-[11px] font-black text-[#3182f6]">오늘의 문장</p>
        <p className="mt-1 text-lg font-black leading-tight text-[#191f28]">“확신보다 확인을 원했다.”</p>
        <p className="mt-2 text-[11px] font-bold text-[#6b7684]">다음 연습 · 대답 전 2초 더 듣기</p>
      </div>
    </PhoneFrame>
  );
}

const WAVE = [8, 15, 25, 18, 10, 23, 28, 13, 20, 9, 16, 24, 11];

/** 리딩 화면 느낌의 구성 도식. 실제 대본 제목 같은 데이터는 넣지 않는다. */
export function ReadingPanel() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div className="space-y-3 rounded-[28px] bg-white p-5 shadow-[0_24px_60px_rgba(25,31,40,0.12)] ring-1 ring-[#edf0f3]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-[#191f28]">내 리딩 대본</p>
          <span className="rounded-full bg-[#3182f6] px-2.5 py-1 text-[11px] font-black text-white">개수 제한 없음</span>
        </div>
        {[72, 58, 84].map((w, i) => (
          <div key={w} className="flex items-center gap-3 rounded-2xl bg-[#f9fafb] p-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e8f3ff] text-sm font-black text-[#3182f6]">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-2.5 rounded-full bg-[#d1d6db]" style={{ width: `${w}%` }} />
              <span className="block h-2 w-1/3 rounded-full bg-[#edf0f3]" />
            </div>
            <span className="text-xs font-black text-[#3182f6]">반복 연습</span>
          </div>
        ))}
      </div>
      <div className="-mt-3 ml-auto w-[88%] rounded-[24px] bg-[#191f28] p-5 text-white shadow-[0_24px_50px_rgba(25,31,40,0.28)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-black">발음 보고서</p>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-black text-[#8fbfff]">Pro 전용 · 준비 중</span>
        </div>
        <div className="mt-4 flex h-9 items-center gap-1">
          {WAVE.map((h, i) => (
            <span key={`${h}-${i}`} className="w-1.5 rounded-full bg-[#8fbfff]" style={{ height: h + 6 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 챌린지 참여작에 붙는 Pro 배지 도식. */
export function BadgePanel() {
  return (
    <div className="mx-auto w-full max-w-[420px] space-y-3">
      <div className="rounded-[24px] bg-white p-5 shadow-[0_24px_60px_rgba(25,31,40,0.12)] ring-1 ring-[#edf0f3]">
        <p className="text-xs font-black text-[#6b7684]">챌린지 참여작</p>
        <div className="mt-3 aspect-video rounded-2xl bg-gradient-to-br from-[#4e5968] to-[#dbeafe]" />
        <div className="mt-4 flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-full bg-[#d1d6db]" />
          <span className="h-2.5 w-24 rounded-full bg-[#d1d6db]" />
          <ProChip />
        </div>
      </div>
      <div className="ml-8 rounded-[20px] bg-white p-4 shadow-[0_16px_40px_rgba(25,31,40,0.1)] ring-1 ring-[#edf0f3]">
        <p className="text-xs font-black text-[#6b7684]">댓글</p>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="h-7 w-7 rounded-full bg-[#e8f3ff]" />
          <span className="h-2.5 w-20 rounded-full bg-[#d1d6db]" />
          <ProChip />
        </div>
      </div>
    </div>
  );
}

export function ProChip() {
  return <span className="rounded-full bg-[#3182f6] px-2 py-0.5 text-[10px] font-black leading-4 text-white">PRO</span>;
}

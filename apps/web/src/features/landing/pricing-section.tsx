import Link from "next/link";

import { PAYMENT_START_NOTICE } from "@/features/help/help-content";

import { FOCUS } from "./shared";

/** 요금 문구는 /pricing 과 같아야 한다. 문구를 바꿀 때는 두 곳을 함께 본다. */
export function PricingSection() {
  return (
    <section aria-labelledby="price-title" className="bg-white text-[#151a30]">
      <div data-reveal className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 lg:py-28">
        <h2 id="price-title" className="text-[clamp(32px,5vw,56px)] font-black leading-[1.12] tracking-[-0.055em]">
          무료로 시작하고,
          <br />
          더 하고 싶을 때 Pro
        </h2>
        <p className="mt-4 text-base text-[#3d4256] sm:text-lg">무료로도 매일 코칭을 받아요. Pro는 횟수 제한 없이, 상위 AI 모델로 더 자세히 코칭해요.</p>
        <p className="mt-2 text-sm font-semibold text-[#8a4b00]">{PAYMENT_START_NOTICE}</p>
        <div className="mt-9 grid gap-4 md:grid-cols-2 md:gap-5">
          <div className="rounded-[28px] border-2 border-[#151a30]/15 bg-white p-6 sm:p-8">
            <h3 className="text-lg font-extrabold">무료</h3>
            <p className="mt-2 text-[40px] font-black tracking-[-0.04em]">0원</p>
            <p className="text-[13.5px] text-[#4e5968]">출시 후 무료 이용 범위 · 지금은 한도를 적용하지 않아요</p>
            <ul className="mt-5 divide-y divide-[#151a30]/10 border-t border-[#151a30]/10 text-[15.5px]">
              <li className="py-2.5">코칭 하루 3회</li>
              <li className="py-2.5">리딩 대본 3개 보관</li>
              <li className="py-2.5">챌린지 참여·시청·댓글</li>
            </ul>
          </div>
          <div className="rounded-[28px] bg-[#151a30] p-6 text-white sm:p-8">
            <h3 className="text-lg font-extrabold text-[#ffa21f]">Pro</h3>
            <p className="mt-2 text-[40px] font-black tracking-[-0.04em]">
              월 3,900원 <span className="text-base font-semibold text-[#b9c1cc]">부가세 포함</span>
            </p>
            <p className="text-[13.5px] text-[#b9c1cc]">웹은 월 구독 · 결제일부터 1개월마다 자동결제</p>
            <ul className="mt-5 divide-y divide-white/15 border-t border-white/15 text-[15.5px]">
              <li className="py-2.5">코칭 횟수 제한 없음</li>
              <li className="py-2.5">리딩 대본 개수 제한 없음</li>
              <li className="py-2.5">상위 AI 모델·습관을 기억하는 코칭·더 자세한 코칭 노트</li>
              <li className="py-2.5">발음 보고서 (준비 중)</li>
            </ul>
          </div>
        </div>
        <Link href="/pricing" className={`mt-6 inline-block rounded text-base font-extrabold underline underline-offset-4 ${FOCUS}`}>
          요금·해지·환불 자세히 보기 →
        </Link>
      </div>
    </section>
  );
}

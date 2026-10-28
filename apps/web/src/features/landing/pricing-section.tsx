import Link from "next/link";

import { FOCUS, SERIF } from "./shared";

/**
 * 요금. 문구는 /pricing(src/app/pricing/page.tsx)과 같아야 한다. 바꿀 때는 두 곳을 함께 본다.
 * 랜딩에는 대표 항목만 싣고, 나머지(연 구독 외 세부·기간 한정 혜택)는 /pricing 에서 본다.
 */
const PAYMENT_NOTICE =
  "2026년 11월 1일부터 결제를 시작해요. 무료 한도는 이 공지 전에 가입한 회원은 12월 1일부터, 공지 뒤 가입한 회원은 11월 1일부터 적용해요. 10월 31일까지 가입한 회원은 11월 1일부터 7일까지 Pro를 무료로 써요.";

const FREE = ["코칭 하루 3회", "리딩 대본 3개 보관 · 같은 대본 반복 연습은 제한 없음", "챌린지 참여·시청·댓글"];
const PRO = [
  "코칭 횟수 제한 없음",
  "리딩 대본 개수 제한 없음",
  "상위 AI 모델로 코칭",
  "습관을 기억하는 코칭 · 회차를 넘어 반복되는 버릇을 짚어 줘요",
  "더 자세한 코칭 노트 · 장면·대사별 관찰",
  "발음 보고서 (Pro 전용 · 준비 중)",
];

export function PricingSection() {
  return (
    <section aria-labelledby="price-title" className="bg-[#f3ede3] text-[#1c1814]">
      <div data-reveal className="mx-auto max-w-[1200px] px-6 py-24 sm:px-8 lg:py-32">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:items-end lg:gap-20">
          <div>
            <h2 id="price-title" className={`${SERIF} text-[clamp(32px,4.2vw,54px)] leading-[1.22]`}>
              무료로 시작하고,
              <br />
              더 하고 싶을 때 Pro
            </h2>
            <p className="mt-5 text-[17px] leading-[1.7] text-[#5c5247]">
              무료로도 매일 코칭을 받아요. Pro는 횟수 제한 없이, 상위 AI 모델로 더 자세히 코칭해요.
            </p>
          </div>
          <p className="mt-6 border-l border-[#1c1814]/25 pl-4 text-[14px] leading-[1.7] text-[#5c5247] lg:mt-0">{PAYMENT_NOTICE}</p>
        </div>

          <div className="mt-14 grid border-t border-[#1c1814]/80 md:grid-cols-2">
            <div className="py-7 md:pr-10">
              <h3 className="text-[15px] font-semibold text-[#5c5247]">무료</h3>
              <p className={`${SERIF} mt-2 text-[40px] leading-none`}>0원</p>
              <p className="mt-3 text-[14px] text-[#6e6357]">11월 1일부터 무료 이용 범위</p>
              <ul className="mt-6 divide-y divide-[#1c1814]/12 border-t border-[#1c1814]/12 text-[15.5px] leading-[1.55]">
                {FREE.map((item) => (
                  <li key={item} className="py-3">{item}</li>
                ))}
              </ul>
            </div>
            <div className="border-t border-[#1c1814]/15 py-7 md:border-l md:border-t-0 md:pl-10">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#5c5247]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#ffa21f]" />
                Pro
              </h3>
              <p className={`${SERIF} mt-2 text-[40px] leading-none`}>
                월 3,900원 <span className="font-sans text-[15px] font-medium tracking-normal text-[#6e6357]">부가세 포함</span>
              </p>
              <p className="mt-3 text-[14px] text-[#6e6357]">웹은 월 구독 · 결제일부터 1개월마다 자동결제</p>
              <p className="mt-1 text-[14px] text-[#6e6357]">앱(App Store·Google Play)에서는 연 32,500원(부가세 포함) 연 구독도 있어요</p>
              <ul className="mt-6 divide-y divide-[#1c1814]/12 border-t border-[#1c1814]/12 text-[15.5px] leading-[1.55]">
                {PRO.map((item) => (
                  <li key={item} className="py-3">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        <div className="mt-8">
          <Link
            href="/pricing"
            className={`rounded-sm text-[16px] underline decoration-[#1c1814]/35 underline-offset-[5px] transition-colors hover:decoration-[#1c1814] ${FOCUS}`}
          >
            요금·해지·환불 자세히 보기 →
          </Link>
        </div>
      </div>
    </section>
  );
}

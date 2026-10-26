import Link from "next/link";

import { WEB_BILLING_ENABLED } from "@/features/billing/billing-flow";
import { SubscribeButton } from "@/features/billing/subscribe-button";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 구독 안내");

/**
 * 요금(/pricing). 가격·해지·환불 조건을 「Pro 구독하기」 바로 아래에 함께 둔다(SOMA-834 웹 개편).
 * 사실은 이전 안내와 /refund 그대로다. 결제 버튼의 행선지(/pg-review)는 결제 작업 쪽이 정하므로 바꾸지 않는다.
 */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

const FAQ = [
  ["언제부터 결제되나요?", "2026년 11월 1일부터 결제를 시작해요. 그 전에는 결제되지 않고, 무료 한도도 그날부터 적용해요."],
  ["10월 31일까지 가입했는데 바로 결제해야 하나요?", "아니요. 2026년 10월 31일까지 가입한 회원은 11월 1일부터 7일까지 Pro를 무료로 써요. 11월 8일부터 30일까지는 무료 한도 없이 무료 회원으로 쓰고, 12월 1일부터 무료 한도가 적용돼요. 카드를 등록하지 않으니 자동으로 결제되지 않아요."],
  ["앱에서도 결제할 수 있나요?", "iOS 앱은 App Store, Android 앱은 Google Play로 월 구독(3,900원)이나 연 구독(32,500원)을 결제할 수 있어요. 웹은 월 구독만 있어요. 한 계정은 한 곳에서만 구독할 수 있어요."],
  ["무료 이용자가 자동으로 유료가 되나요?", "현재 무료 이용자가 동의 없이 유료로 전환되지는 않아요."],
  ["해지하면 바로 Pro를 못 쓰나요?", "자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요."],
  ["구독을 해지하면 회원 탈퇴가 되나요?", "구독 해지는 회원 탈퇴와 별개예요."],
] as const;

const COMPARE = [
  ["AI 연기 코칭", "하루 3회", "제한 없음"],
  ["코칭 AI 모델", "기본 모델", "상위 모델"],
  ["습관을 기억하는 코칭", "—", "회차를 넘어 반복되는 버릇을 짚어 줘요"],
  ["코칭 노트", "기본", "장면·대사별로 더 자세히"],
  ["리딩 대본 보관", "3개", "제한 없음"],
  ["같은 대본 반복 연습", "제한 없음", "제한 없음"],
  ["리딩 고품질 목소리", "10월 31일까지 무료", "포함"],
  ["발음 보고서", "—", "준비 중"],
  ["연습 중 광고", "—", "광고 없음"],
  ["챌린지 참여·시청·댓글", "무료", "무료 · Pro 배지"],
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-dvh break-keep bg-white text-[#191f28]">
      <SiteHeader current="pricing" />
      <main className="mx-auto max-w-[900px] px-5 pb-16 sm:px-8 lg:pb-24">
        <section aria-labelledby="pricing-title" className="pb-6 pt-9 sm:pb-9 sm:pt-16 sm:text-center">
          <p className="text-sm font-extrabold text-[#4880ee]">ACTTUB Pro 구독 안내</p>
          <h1 id="pricing-title" className="mt-2 text-[30px] font-extrabold leading-[1.25] tracking-[-0.035em] sm:text-[46px]">
            필요한 만큼만,<br className="sm:hidden" /> 월 3,900원
          </h1>
          <p className="mt-3 text-[15.5px] text-[#4e5968] sm:text-lg">무료로 시작하고, 더 자주 연습하고 싶을 때 Pro로 바꿔요.</p>
        </section>

        <aside aria-label="결제 시작 안내" className="mb-6 flex gap-2.5 rounded-[14px] bg-[#fff1e8] px-[18px] py-3.5 text-[13.5px] font-semibold leading-5 text-[#8a4b00] sm:text-[15px]">
          <span aria-hidden="true">⚠</span>
          <p>2026년 11월 1일부터 결제를 시작해요. 무료 한도도 그날부터 적용해요. 10월 31일까지 가입한 회원은 11월 1일부터 7일까지 Pro를 무료로 써요.</p>
        </aside>

        <div className="flex flex-col-reverse gap-3 md:grid md:grid-cols-2 md:gap-5">
          <section aria-labelledby="free-title" className="flex flex-col rounded-3xl border border-[#e5e8eb] p-[22px] sm:p-[30px]">
            <h2 id="free-title" className="text-lg font-extrabold">무료</h2>
            <p className="mt-2 text-[28px] font-extrabold tracking-[-0.03em] sm:text-[34px]">0원</p>
            <p className="text-[13.5px] text-[#6b7684]">11월 1일부터 무료 이용 범위</p>
            <ul className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3] text-[15.5px] text-[#333d4b]">
              <li className="py-2.5">코칭 하루 3회</li>
              <li className="py-2.5">리딩 대본 3개 보관 · 같은 대본 반복 연습은 제한 없음</li>
              <li className="py-2.5">챌린지 참여·시청·댓글</li>
            </ul>
            <p className="mt-4 text-[13.5px] leading-[1.6] text-[#6b7684]">
              2026년 10월 31일까지 가입한 회원은 11월 7일까지 Pro를 무료로 쓰고, 11월 30일까지는 무료 한도 없이 써요. 이 범위는 12월 1일부터 적용해요. 11월 1일 이후 가입한 회원은 바로 적용해요. 카드 등록이 없어 자동으로 결제되지 않아요.
            </p>
          </section>

          <section aria-labelledby="pro-title" className="flex flex-col rounded-3xl border-2 border-[#4880ee] bg-[#f5f9ff] p-[22px] sm:p-[30px]">
            <h2 id="pro-title" className="text-lg font-extrabold">Pro</h2>
            <p className="mt-2 text-[28px] font-extrabold tracking-[-0.03em] sm:text-[34px]">
              월 3,900원 <span className="text-base font-semibold text-[#6b7684]">부가세 포함</span>
            </p>
            <p className="text-[13.5px] text-[#6b7684]">웹은 월 구독 · 결제일부터 1개월마다 자동결제</p>
            <p className="text-[13.5px] text-[#6b7684]">앱(App Store·Google Play)에서는 연 32,500원(부가세 포함) 연 구독도 있어요</p>
            <ul className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3] text-[15.5px] text-[#333d4b]">
              <li className="py-2.5">코칭 횟수 제한 없음</li>
              <li className="py-2.5">리딩 대본 개수 제한 없음</li>
              <li className="py-2.5">상위 AI 모델로 코칭</li>
              <li className="py-2.5">습관을 기억하는 코칭 · 회차를 넘어 반복되는 버릇을 짚어 줘요</li>
              <li className="py-2.5">더 자세한 코칭 노트 · 장면·대사별 관찰</li>
              <li className="py-2.5">발음 보고서 (Pro 전용 · 준비 중)</li>
              <li className="py-2.5">리딩 고품질 목소리 (10월 31일까지는 모두 무료)</li>
              <li className="py-2.5">연습 중 광고 없음</li>
              <li className="py-2.5">참여작·댓글·프로필에 Pro 배지</li>
            </ul>
            {WEB_BILLING_ENABLED ? (
              <SubscribeButton
                className={`mt-5 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[#4880ee] text-base font-bold text-white transition hover:bg-[#3268d8] ${FOCUS}`}
              >
                Pro 구독하기
              </SubscribeButton>
            ) : (
              <Link
                href="/pg-review"
                className={`mt-5 flex h-[52px] items-center justify-center rounded-[14px] bg-[#4880ee] text-base font-bold text-white transition hover:bg-[#3268d8] ${FOCUS}`}
              >
                Pro 구독하기
              </Link>
            )}
            <p className="mt-3 text-[13.5px] leading-[1.6] text-[#6b7684]">
              언제든 다음 자동결제를 해지할 수 있고, 해지해도 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요. 유료 기능을 쓰지 않았다면 결제 후 7일 이내에 전액 환불하고, 이용한 뒤에는 이용한 날짜만큼 빼고 환불해요.
            </p>
            <p className="mt-2 text-[13.5px] leading-[1.6] text-[#6b7684]">Pro 배지는 구독 표시이며 배우의 실력이나 자격을 인증하는 표시는 아니에요.</p>
          </section>
        </div>

        <section id="compare" aria-labelledby="compare-title" className="mt-14 scroll-mt-24">
          <h2 id="compare-title" className="text-xl font-extrabold sm:text-2xl">무료와 Pro 비교</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-[15px] sm:text-base">
              <thead>
                <tr className="text-sm text-[#6b7684]">
                  <th scope="col" className="border-b border-[#e5e8eb] py-3 pr-3 font-bold">항목</th>
                  <th scope="col" className="border-b border-[#e5e8eb] px-3 py-3 font-bold">무료</th>
                  <th scope="col" className="border-b border-[#e5e8eb] px-3 py-3 font-bold">Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, free, pro]) => (
                  <tr key={label}>
                    <th scope="row" className="border-b border-[#edf0f3] py-4 pr-3 font-semibold">{label}</th>
                    <td className="border-b border-[#edf0f3] px-3 py-4 text-[#4e5968]">{free}</td>
                    <td className="border-b border-[#edf0f3] px-3 py-4 font-bold text-[#3268d8]">{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="pay-faq-title" className="mt-14 flex flex-col gap-6 lg:flex-row lg:gap-16">
          <div className="lg:w-[260px]">
            <h2 id="pay-faq-title" className="text-xl font-extrabold sm:text-[28px] sm:leading-tight">결제 전에 확인하세요</h2>
            <Link href="/refund" className={`mt-3 inline-block rounded text-[15px] font-bold text-[#3268d8] hover:underline ${FOCUS}`}>
              해지·환불 정책 전문 →
            </Link>
          </div>
          <div className="flex-1">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border-b border-[#e5e8eb]">
                <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-bold ${FOCUS}`}>
                  {q}
                  <span aria-hidden="true" className="text-[22px] font-normal text-[#8b95a1] transition group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 text-[15.5px] leading-[1.65] text-[#4e5968]">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

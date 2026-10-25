import Link from "next/link";
import { SubscribeButton } from "@/features/billing/subscribe-button";
import { WEB_BILLING_ENABLED } from "@/features/billing/billing-flow";
import { BusinessInfo } from "@/features/business-info/business-info";
import {
  BadgePanel,
  CheckIcon,
  CoachingPhone,
  ProTopBar,
  ReadingPanel,
} from "@/features/pricing/pro-ui";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 구독 안내");

const FAQ = [
  ["지금 결제되나요?", "유료 결제는 11월 시작을 준비하고 있어요. 결제 시작 전에는 실제로 결제되지 않고, 정확한 시작일은 별도로 안내해요."],
  ["무료 이용자가 자동으로 유료가 되나요?", "현재 무료 이용자가 동의 없이 유료로 전환되지는 않아요."],
  ["해지하면 바로 Pro를 못 쓰나요?", "자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요."],
  ["구독을 해지하면 회원 탈퇴가 되나요?", "구독 해지는 회원 탈퇴와 별개예요."],
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <aside aria-labelledby="launch-title" className="bg-[#191f28] px-5 py-2.5 text-xs leading-5 text-[#d1d6db] sm:px-8">
        <div className="mx-auto max-w-6xl">
          <span id="launch-title" className="mr-2 rounded-full bg-[#3182f6] px-2 py-0.5 text-[11px] font-black text-white">결제 시작 안내</span>
          유료 결제는 11월 시작을 준비하고 있어요. 그 전에는 실제로 결제되지 않고, 무료 한도도 아직 적용하지 않아요.
        </div>
      </aside>
      <ProTopBar backHref="/" backLabel="ACTTUB 홈" />
      <main>
        {/* 1. 히어로 */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-12 pt-4 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-black text-[#3182f6] shadow-[0_6px_24px_rgba(49,130,246,0.1)]">ACTTUB Pro 구독 안내</p>
            <h1 className="mt-5 text-[29px] font-black leading-[1.22] tracking-[-0.04em] sm:text-5xl lg:text-[56px]">
              혼자 하는 연기 연습을
              <br />
              <span className="text-[#3182f6]">더 자주, 더 자세히</span> 살펴봐요.
            </h1>
            <div className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-5xl font-black tracking-[-0.04em] sm:text-6xl">월 3,900원</span>
            </div>
            <p className="mt-3 text-sm font-bold text-[#6b7684]">부가세 포함 · 결제일부터 1개월 · 매월 정기결제</p>
            <div className="mt-7 flex flex-wrap gap-3">
              {WEB_BILLING_ENABLED ? <SubscribeButton className="inline-flex h-12 items-center rounded-2xl bg-[#3182f6] px-6 text-base font-black text-white shadow-[0_14px_34px_rgba(49,130,246,0.28)] transition hover:bg-[#1b64da]">Pro 구독하기</SubscribeButton> : <Link href="/pg-review" className="inline-flex h-12 items-center rounded-2xl bg-[#3182f6] px-6 text-base font-black text-white shadow-[0_14px_34px_rgba(49,130,246,0.28)] transition hover:bg-[#1b64da]">Pro 구독하기</Link>}
              <a href="#compare" className="inline-flex h-12 items-center rounded-2xl bg-[#191f28] px-6 text-base font-black text-white shadow-[0_14px_34px_rgba(25,31,40,0.18)] transition hover:bg-[#333d4b]">무료와 Pro 비교</a>
              <Link href="/refund" className="inline-flex h-12 items-center rounded-2xl border border-[#d1d6db] bg-white px-6 text-base font-black text-[#191f28] transition hover:bg-[#f9fafb]">해지·환불정책</Link>
            </div>
          </div>
          <div className="relative py-2">
            <div className="absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-[#3182f6]/[0.16] blur-3xl" />
            <CoachingPhone />
          </div>
        </section>

        {/* 2. 무료 vs Pro */}
        <section id="compare" aria-label="무료와 Pro 비교" className="mx-auto grid w-full max-w-6xl gap-4 px-5 pb-6 sm:px-8 md:grid-cols-[0.9fr_1.1fr] md:items-stretch">
          <section aria-labelledby="free-title" className="flex flex-col rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8">
            <h2 id="free-title" className="text-sm font-black text-[#6b7684]">출시 후 무료 이용 범위</h2>
            <p className="mt-2 text-4xl font-black tracking-[-0.04em]">무료</p>
            <ul className="mb-6 mt-6 space-y-4 text-base font-bold leading-7 text-[#4e5968]">
              <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8b95a1]" />코칭은 하루 1회 이용해요.</li>
              <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8b95a1]" />리딩 대본은 동시에 1개 보관해요. 삭제 후 다른 대본으로 교체할 수 있고, 같은 대본의 반복 연습에는 횟수 제한이 없어요.</li>
              <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8b95a1]" />챌린지 참여·시청·댓글은 무료로 이용해요.</li>
            </ul>
            <p className="mt-auto rounded-2xl bg-[#f2f4f6] p-4 pt-4 text-sm font-bold leading-6 text-[#6b7684]">무료와 Pro는 같은 코치와 리딩 음성 품질을 제공해요. 발음·딕션 피드백은 Pro 전용이에요. 현재 무료 이용 범위의 변경 시점과 기존 이용자 적용 방법은 판매 시작 전에 안내해요.</p>
          </section>
          <section aria-labelledby="pro-title" className="relative overflow-hidden rounded-[28px] bg-[#191f28] p-6 text-white shadow-[0_30px_70px_rgba(25,31,40,0.22)] sm:p-8">
            <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#3182f6]/40 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <h2 id="pro-title" className="text-2xl font-black">ACTTUB Pro</h2>
              </div>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="text-5xl font-black tracking-[-0.04em]">월 3,900원</span>
              </p>
              <p className="mt-2 text-sm font-bold text-[#b0b8c1]">부가세 포함 · 결제일부터 1개월 · 매월 정기결제</p>
              <ul className="mt-6 space-y-4 text-base font-bold leading-7 text-[#f2f4f6]">
                <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8fbfff]" />AI 연기 코칭을 횟수 제한 없이 이용해요.</li>
                <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8fbfff]" />리딩 대본을 개수 제한 없이 보관하고, 원하는 대본으로 반복 연습해요.</li>
                <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8fbfff]" />리딩에서 발음·딕션 피드백을 확인해요. 이 기능은 Pro 전용으로 준비 중이에요.</li>
                <li className="flex gap-3"><CheckIcon className="mt-1 text-[#8fbfff]" />챌린지 참여작·댓글·프로필에 Pro 배지를 표시해요. 구독 표시이며 배우의 실력이나 자격을 인증하는 표시는 아니에요.</li>
              </ul>
              {WEB_BILLING_ENABLED ? <SubscribeButton className="mt-7 flex h-14 w-full items-center justify-center rounded-2xl bg-white text-lg font-black text-[#191f28] transition hover:bg-[#f2f4f6]">Pro 구독하기</SubscribeButton> : <Link href="/pg-review" className="mt-7 flex h-14 w-full items-center justify-center rounded-2xl bg-white text-lg font-black text-[#191f28] transition hover:bg-[#f2f4f6]">Pro 구독하기</Link>}
              <p className="mt-3 text-sm font-bold leading-6 text-[#b0b8c1]">결제 시작 전에는 실제로 결제되지 않아요. 무료 이용자가 동의 없이 유료로 전환되지는 않아요.</p>
            </div>
          </section>
        </section>
        <div className="pb-6" />

        {/* 3. Pro 기능 */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 pb-6 sm:px-8 md:grid-cols-2">
          <div className="order-2 md:order-1"><div className="rounded-[36px] bg-[#e8f3ff] px-4 py-10"><CoachingPhone /></div></div>
          <div className="order-1 md:order-2">
            <p className="text-sm font-black text-[#3182f6]">Pro · AI 연기 코칭</p>
            <h2 className="mt-3 text-3xl font-black leading-[1.25] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl">AI 연기 코칭을 횟수 제한 없이 이용해요.</h2>
            <p className="mt-4 text-base font-bold leading-7 text-[#4e5968]">무료는 하루 1회, Pro는 제한 없이 이용해요. 무료와 Pro는 같은 코치를 제공해요.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-white p-5 ring-1 ring-[#e5e8eb]"><p className="text-sm font-black text-[#6b7684]">무료</p><p className="mt-1 text-2xl font-black">하루 1회</p></div>
              <div className="rounded-3xl bg-[#3182f6] p-5 text-white"><p className="text-sm font-black text-[#dbeafe]">Pro</p><p className="mt-1 text-2xl font-black">제한 없음</p></div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-10 grid w-full max-w-6xl items-center gap-8 rounded-[36px] bg-white px-5 py-10 ring-1 ring-[#e5e8eb] sm:px-10 md:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-sm font-black text-[#3182f6]">Pro · 리딩</p>
            <h2 className="mt-3 text-3xl font-black leading-[1.25] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl">대본은 개수 제한 없이 보관하고, 발음·딕션까지 확인해요.</h2>
            <p className="mt-4 text-base font-bold leading-7 text-[#4e5968]">리딩 대본을 개수 제한 없이 보관하고, 원하는 대본으로 반복 연습해요. 리딩에서 발음·딕션 피드백을 확인해요. 이 기능은 Pro 전용으로 준비 중이에요.</p>
          </div>
          <ReadingPanel />
        </section>

        <section className="mx-auto mt-10 grid w-full max-w-6xl items-center gap-8 px-5 pb-14 sm:px-8 md:grid-cols-[1.1fr_1fr]">
          <BadgePanel />
          <div>
            <p className="text-sm font-black text-[#3182f6]">Pro · 챌린지</p>
            <h2 className="mt-3 text-3xl font-black leading-[1.25] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl">참여작·댓글·프로필에 Pro 배지를 표시해요.</h2>
            <p className="mt-4 text-base font-bold leading-7 text-[#4e5968]">구독 표시이며 배우의 실력이나 자격을 인증하는 표시는 아니에요.</p>
          </div>
        </section>

        {/* 4. 안심 블록 */}
        <section aria-labelledby="billing-title" className="bg-[#191f28] px-5 py-14 text-white sm:px-8 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-black text-[#8fbfff]">결제와 해지</p>
            <h2 id="billing-title" className="mt-3 text-3xl font-black leading-[1.25] tracking-[-0.03em] sm:text-5xl">언제든 다음 자동결제를<br className="hidden sm:block" /> 해지할 수 있어요</h2>
            <p className="mt-5 max-w-2xl text-base font-bold leading-7 text-[#b0b8c1]">웹에서 신청하는 월 정기결제 상품으로 준비하고 있어요. 언제든 다음 자동결제를 해지할 수 있고, 구독 해지는 회원 탈퇴와 별개예요. 유료 기능을 쓰지 않았다면 결제 후 7일 이내에 전액 환불하고, 이용한 뒤에는 이용한 날짜만큼 빼고 환불해요.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl bg-[#3182f6] p-6 sm:col-span-2"><p className="text-xl font-black leading-snug">자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요.</p></div>
              <div className="rounded-3xl bg-white/10 p-6"><p className="text-base font-black leading-snug">구독 해지는 회원 탈퇴와 별개예요.</p></div>
            </div>
            <Link href="/refund" className="mt-8 inline-flex h-12 items-center rounded-2xl bg-white px-6 text-base font-black text-[#191f28] transition hover:bg-[#f2f4f6]">환불 기준과 요청 방법 보기</Link>
          </div>
        </section>

        {/* 5. FAQ */}
        <section aria-labelledby="faq-title" className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
          <h2 id="faq-title" className="text-2xl font-black tracking-[-0.03em]">자주 묻는 질문</h2>
          <div className="mt-5 divide-y divide-[#e5e8eb] rounded-3xl bg-white px-5 ring-1 ring-[#e5e8eb]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-black">
                  {q}
                  <span aria-hidden="true" className="text-xl text-[#3182f6] transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-base font-bold leading-7 text-[#4e5968]">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-[#e5e8eb] bg-white px-5 py-8 text-sm leading-7 text-[#6b7684] sm:px-8">
        <div className="mx-auto max-w-6xl">
          <BusinessInfo />
          <Link href="/terms" className="mt-3 inline-block font-bold text-[#3182f6] underline underline-offset-4">이용약관·개인정보 처리방침</Link>
        </div>
      </footer>
    </div>
  );
}
